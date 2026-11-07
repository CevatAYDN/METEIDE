import {
	err,
	ok,
	type Result,
	type SecretError,
	type SecretStore,
} from "@mete/contracts";

type Queue = {
	readonly tails: Map<string, Promise<void>>;
	readonly failures: Map<string, SecretError>;
};

// Operational state only: completed queues retain safe failures, never credential values.
const queues = new WeakMap<SecretStore, Queue>();

const recordResult = <T>(
	queue: Queue,
	name: string,
	result: Result<T, SecretError>,
) => {
	if (result.ok) queue.failures.delete(name);
	else if (
		/cleanup|rollback|committed|operation failed/i.test(result.error.message)
	)
		queue.failures.set(name, result.error);
};

const enqueue = <T>(
	queue: Queue,
	name: string,
	run: () => Promise<Result<T, SecretError>>,
	mutation: boolean,
): Promise<Result<T, SecretError>> => {
	const result = (queue.tails.get(name) ?? Promise.resolve()).then(async () => {
		let outcome: Result<T, SecretError>;
		try {
			outcome = await run();
		} catch {
			outcome = err({
				code: "secret_failed",
				message: "Credential operation failed",
			});
		}
		if (mutation) recordResult(queue, name, outcome);
		return outcome;
	});
	const tail = result.then(() => undefined);
	queue.tails.set(name, tail);
	return result.finally(() => {
		if (queue.tails.get(name) === tail) queue.tails.delete(name);
	});
};

const settled = async (queue: Queue): Promise<Result<void, SecretError>> => {
	while (queue.tails.size) await Promise.all([...queue.tails.values()]);
	const failure = queue.failures.values().next().value;
	return failure ? err(failure) : ok(undefined);
};

/** Shares per-name ordering and unresolved mutation failures across instances of one SecretStore. */
export const credentialRecordQueue = (secrets: SecretStore) => {
	let queue = queues.get(secrets);
	if (!queue) {
		queue = { tails: new Map(), failures: new Map() };
		queues.set(secrets, queue);
	}
	const current = queue;
	return {
		read: <T>(name: string, run: () => Promise<Result<T, SecretError>>) =>
			enqueue(current, name, run, false),
		mutate: (name: string, run: () => Promise<Result<void, SecretError>>) =>
			enqueue(current, name, run, true),
		settled: () => settled(current),
	};
};
