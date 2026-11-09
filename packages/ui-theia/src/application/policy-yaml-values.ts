import { err, ok, type Result } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import {
	isAlias,
	isMap,
	isNode,
	isScalar,
	isSeq,
	type Node,
	visit,
	type YAMLMap,
	type YAMLSeq,
} from "yaml";
import {
	POLICY_RULE_KEYS,
	type PolicyRuleKey,
	readPolicyRule,
} from "./policy-rule-fields.js";
import type { Doc } from "./yaml-section.js";

const refused = () =>
	err(
		nls.localize(
			"mete/permissions/yamlManual",
			"These rules need a source edit to preserve their YAML comments and shared values.",
		),
	);

const mapKeysSafe = (node: YAMLMap): boolean => {
	const keys = node.items.map((pair) =>
		isScalar(pair.key) ? pair.key.value : pair.key,
	);
	return (
		keys.every((key) => typeof key === "string" && key !== "<<") &&
		new Set(keys).size === keys.length
	);
};

const unsafe = (root: Node): boolean => {
	let found = false;
	visit(root, (_key, node) => {
		if (
			isAlias(node) ||
			(isNode(node) && (node.tag || ("anchor" in node && node.anchor))) ||
			(isMap(node) && !mapKeysSafe(node))
		)
			found = true;
	});
	return found;
};

const commented = (root: Node): boolean => {
	let found = false;
	visit(root, {
		Node: (_key, node) => {
			if (node.comment || node.commentBefore) found = true;
		},
	});
	return found;
};

// Validated sequence entries are strings or action/path/command rules, independent of key order.
const signature = (node: Node) =>
	JSON.stringify(node.toJSON(), ["action", "path", "command"]);

const sequence = (
	before: YAMLSeq<Node>,
	after: YAMLSeq<Node>,
): Result<Node, string> => {
	const oldKeys = before.items.map(signature);
	const newKeys = after.items.map(signature);
	for (const key of new Set(oldKeys)) {
		const oldCount = oldKeys.filter((k) => k === key).length;
		const newCount = newKeys.filter((k) => k === key).length;
		if (oldCount > 1 && newCount > 0 && newCount < oldCount) return refused();
	}
	const remaining = [...before.items];
	let added = false;
	// Equal duplicates retain their occurrence order; a new entry never borrows another value's node.
	const items = after.items.map((node) => {
		const match = remaining.find((old) => signature(old) === signature(node));
		if (!match) {
			added = true;
			return node;
		}
		remaining.splice(remaining.indexOf(match), 1);
		return match;
	});
	if (added && remaining.some(commented)) return refused();
	before.items = items;
	return ok(before);
};

const mapping = (before: YAMLMap, after: YAMLMap): Result<Node, string> => {
	before.items = before.items.filter((pair) => after.has(pair.key));
	for (const pair of after.items) {
		const current = before.get(pair.key, true);
		if (current === undefined) before.add(pair);
		else if (isScalar(current) && isScalar(pair.value))
			current.value = pair.value.value;
		else return refused();
	}
	return ok(before);
};

const merge = (before: unknown, after: Node): Result<Node, string> => {
	if (before === undefined) return ok(after);
	if (isMap(before) && isMap(after)) return mapping(before, after);
	if (isSeq<Node>(before) && isSeq<Node>(after)) return sequence(before, after);
	return refused();
};

const parentsSafe = (
	doc: Pick<Doc, "contents" | "getIn">,
	at: readonly string[],
): boolean => {
	for (let n = 0; n < at.length; n++) {
		const node = n === 0 ? doc.contents : doc.getIn(at.slice(0, n), true);
		if (
			node != null &&
			(!isMap(node) || node.anchor || node.tag || !mapKeysSafe(node))
		)
			return false;
	}
	return true;
};

const existing = (key: PolicyRuleKey, node: unknown) => {
	if (node === undefined) return ok(undefined);
	if (!isNode(node) || unsafe(node)) return refused();
	return readPolicyRule(key, node.toJSON());
};

/** Atomically sets one explicit policy rule field with retained nodes; refusal leaves doc untouched. */
export const setPolicyYamlValue = (
	doc: Doc,
	at: readonly string[],
	value: unknown,
): Result<void, string> => {
	try {
		const field = POLICY_RULE_KEYS.find(
			(key) => at.join(".") === key || at.join(".") === `policy.${key}`,
		);
		if (!field || doc.errors.length > 0) return refused();
		const parsed = readPolicyRule(field, value);
		if (!parsed.ok) return parsed;
		if (parsed.value === undefined) return refused();
		const copy = doc.clone();
		if (!parentsSafe(copy, at)) return refused();
		const before = copy.getIn(at, true);
		const checked = existing(field, before);
		if (!checked.ok) return checked;
		const next = copy.createNode(parsed.value, {
			aliasDuplicateObjects: false,
		});
		const result = merge(before, next);
		if (!result.ok) return result;
		copy.setIn(at, result.value);
		doc.contents = copy.contents;
		return ok(undefined);
	} catch {
		// yaml throws for unsupported collection operations; no staged node is committed on refusal.
		return refused();
	}
};
