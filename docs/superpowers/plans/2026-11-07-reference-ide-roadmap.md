# Referans ozellikler ve IDE kullanilabilirligi

Date: 2026-11-07
Status: User approved F1-F7 followed by P1-P5 on 2026-11-07 ("devam et").
ADR-180 foundation and ADR-181 parallel work are implemented. C1-C3 were approved
under ADR-182. C4-C5 were approved under ADR-183; T/G/K decisions still
require their own approval.
This plan does not promote Phase 6 automatically.
Baseline: `ac410907` plus the current uncommitted ADR-180 implementation.

## Hedef ve sinir

METE'nin gelismis yetenekleri kullanici icin bulunabilir, kurulabilir, anlasilir ve
geri alinabilir olmali. Bir cekirdek sinifinin bulunmasi, kullanici akisi tamamlandi
anlamina gelmez. Bir upstream README iddiasi da METE'de calisan ozellik sayilmaz.

Referans seti mevcut proje belgelerinden gelir: ChatDev, CrewAI, MetaGPT,
openai/codex ve microsoft/TokenEconomizer. IDE etkilesim referansi Theia/VS Code'dur.
Kaynak matrisi: `docs/reviews/2026-11-07-reference-feature-matrix.md`.
Matris onemli ozellik ailelerini karsilastirir; tum upstream kod dallarinin ya da
gelecekte eklenecek her ozelligin eksiksiz envanteri oldugu iddia edilmez.

Degismezler:

- Theia editor, terminal, debugger, SCM ve eklenti hostu yeniden yazilmaz.
- Cekirdek capability ID ve model tier kullanir; upstream adlari cekirdege girmez.
- Harici motorlar gateway, policy, quota, masking ve olay sozlesmelerini asamaz.
- Yapilandirma yalniz kullanici eylemiyle yazilir; ajan kendi yetkisini artiramaz.
- Kayip/bozuk/bilinmeyen durum basarili veya bagli diye gosterilmez.
- Gercek model saglayicilarina test istegi gonderilmez.
- Signing, hesap baglama, satin alma, yayinlama ve push bu planin parcasi degildir.

## Yaklasimlar

1. **Onerilen: once kullanici akisi, sonra yerel cekirdek yetenekleri.** Mevcut
   Theia araclarini birlestir, kismi native ozellikleri tamamla, sonrasinda gerek
   varsa opsiyonel upstream adapterlarini ekle. En az cift kod ve en net sahiplik.
2. **Once upstream motor adapterlari.** Daha cabuk motor cesitliligi saglar,
   fakat desteklenmeyen alanlar, Python runtime ve guvenlik esleme yukunu artirir.
3. **Tum ozellikleri bir kerede kopyalama.** Onerilmez: kabul kriteri belirsiz,
   lisans/sozlesme riski yuksek, mevcut phase ve paket boyutu kurallarina aykiri.

## Tamamlanan Temel

ADR-180 kapsaminda bu calismada gelistirilenler:

- Kompakt ve tema uyumlu operasyon ekranlari, gorunur mesaj yazma alani.
- Ayarlarda arama, kapsam secimi ve acilir gelismis degerler.
- MCP icin URL/komut/JSON taslagi, duplicate/unsupported-field dogrulamasi.
- Salt okunur gercek registry arama/hazirlama, ayri taslak ekleme eylemi.
- Guvenli save/connect; atomik idle gate, eski Connected sonucunu gecersiz kilma.
- Konusma icin kalici Web/MCP capability secimi ve guvenli follow-up.
- Native Extensions girisi ve kullanici istegiyle Open VSX aramasi.

Bu liste tum IDE veya tum upstream ozellikleri tamamlandi demek degildir.
VSIX kurulum/kaldirma tam dongusu F1 ile kaynaktan derlenen Electron'da dogrulandi.
Credential gerektiren MCP kurulum UX'i ve paketlenmis release kabul kriterleri
acik kalir.

## Oncelikli Paket Dilimleri

Her satir bir uygulama dilimidir: tek paket, tek konu, yaklasik 300 satir degisim
ust siniri. Daha buyuk cikan satir yeniden bolunur. Ortak sozlesme degisiklikleri
ayri dilimde ve gereken capability surum artisi ile yapilir.

| ID | Paket | Is / kullanici sonucu | Bagimlilik | Kabul kaniti |
| --- | --- | --- | --- | --- |
| F1 | desktop | Native VSIX install, enable/disable, uninstall dongusunu yerel zararsiz fixture ile dogrula | ADR-180 | Kurulu gorunum, eklenti komutu, kaldirma sonrasi yokluk; internet kapali |
| F2 | ui-theia | Tek bir compact composer duzeni; model secimi ve baslat eylemi ekranlar arasinda ayni yerde | ADR-180 | Klavye, uzun hedef/metin, 700/1366 genislik, 3 tema |
| F3 | ui-theia | Tools sayfasinda kurulu/taslak/pending/hata durumlarini ve yeniden denemeyi tek tutarli akis yap | ADR-180 | Scope switch, disk hatasi, duplicate ID, aktif run, shadowed global sunucu |
| F4 | desktop | Editor/search/terminal/SCM arasindaki ana gorev akisini test et | Native Theia | Dosya ac-duzenle-ara-diff akisi, odak ve panel geri donusu |
| F5 | ui-theia | Team editor'da gelismis verify/review/best-of-N seceneklerini bulunabilir hale getir | Mevcut schema | Kaydet-yeniden ac, form/YAML kayipsiz esdegerlik |
| F6 | desktop | Native debugger breakpoint/step/variables dongusunu yerel Node fixture ile dogrula | Native js-debug | Breakpoint durusu, kaynak satiri, degisken ve devam davranisi |
| F7 | desktop | Build task -> problem matcher -> kaynak satiri dongusunu dogrula | Native tasks/markers | Deterministik derleme hatasi, tiklanabilir tani, basarili tekrar |
| C1 | contracts | Konusma kimligi ve secim okunabilirligi icin yeni versioned port tasarla | ADR-182 kabul edildi | Eski run/reply testleri degismeden uyumluluk |
| C2 | core | Tamamlanmis turn'leri tek konusma kimligine bagla; legacy kayitlari koru | C1 | Yeniden baslatma, siralama, eski DB, degismez predecessor |
| C3 | ui-theia | Sidebar'da tek konusma satiri, gecmiste arama ve run ayrintisina gecis | C2 | Iki mesaj iki gereksiz sohbet satiri olusturmaz; legacy run erisilebilir |
| C4 | contracts | Dosya/secili kod baglami ve boyut/mahremiyet kurallarini tanimla | ADR karari | Ignore/protected path, invalid input, taint ve limit testleri |
| C5 | ui-theia | Editor seciminden konusmaya baglam ekle, gondermeden gor/kaldir | C4 + backend dilimi | Eklenen icerik acik, iptal kayipsiz, sessiz dosya gonderimi yok |
| T1 | contracts | MCP sign-in/required-secret/probe durumlari icin versioned port | Auth/secret ADR | Gizli deger sonuc/event/log'a donmez |
| T2 | mcp | Mevcut OAuth ve secret store'u desktop kullanici akisi icin adapterla | T1 | Loopback OAuth, iptal, expired token, provider error fake'leri |
| T3 | ui-theia | Registry gereksinimlerini alanlara donusturen guided auth/setup | T2 | Kurulum gerekiyor -> hazir -> test; ham secret URL/YAML'ye yazilmaz |
| T4 | contracts | Skill/template kurulum kaynagi, scope, izin ve surum kimligini tanimla | ADR karari | Belirsiz kaynak ve yetki artisi reddi |
| T5 | mcp | Registry taslagini skill/template icin guvenli hazirla; kurulumu otomatik yapma | T4 | Kaynak, versiyon, dogrulama, duplicate ve rollback |
| T6 | ui-theia | Skill/template kesfet, incele, ekle, etkinlestir, kaldir akisi | T5 | Bos/hata/iptal/kurulu durumlari; kullanici onayi |
| P1 | core | ADR-174 worker icinde gercek tool adimlarini task-local calistir | Mevcut ADR-174 | Bounded overlap; butce/reservation; pause/cancel; belirsiz yazim tekrarlanmaz |
| P2 | core | Yazici worker worktree sahipligini bagla; workspace fallback sirali kalsin | P1 | Iki ayri checkout; ayni dosya ve dirty workspace korunur |
| P3 | core | Onay sirasina gore kalici merge kuyrugu | Mevcut sirali worktree merge; P2 gerekmez | Conflict/restart ve dependency landed sirasi |
| P4 | core | Task-local human/policy bekleme; diger hazir gorevler devam eder | P3 | Aktif run'da onay; clarify/review/best-of-N ile kombinasyon |
| P5 | ui-theia | Paralel isler, kim bekliyor ve merge sorunu tek gorev detayindan yonetilir | P4 | Durum/event sirasi, retry, owner/branch gorunurlugu |
| G1 | core | Verify gate yoklugu ile gercek basariyi ayirt eden sonuc davranisini netlestir | Eksik gate ADR | Eksik adapterin sessiz PASS olmamasi; schema/olay karari ayri |
| G2 | ui-theia | Gate/guardrail/review kanitlarini ortak sonuc gorunumunde sun | G1 | Calismadi/basarili/basarisiz ayri, dosya ve loga dogru gecis |
| K1 | knowledge | ADR-144 kapsamindaki personal-vault aramasinin eksik caller ve erisim kurallarini tamamla | Mevcut izin sinirlari; belirsiz kararlar ayri ADR | Workspace/personal ayrimi, private/corrupt note reddi, fallback |
| K2 | knowledge | Native code graph indeksleme ve artimli guncelleme | ADR-144; yeni dependency icin ADR | Dosya silme/rename, ignore, stale index, syntax error, kaynak yolu |
| K3 | knowledge | Rerank ve backlink/graph fusion caller'larini mevcut aramaya bagla | K1-K2 | Kaynak siralamasi, adapter eksikligi, timeout, ayni sonucu deterministik tekrar |
| K4 | contracts | Runtime skill discovery/matching/injection sozlesmesini netlestir | Skill izin/scope ADR | Frontmatter, boyut siniri, injection sinifi, etkilesimli secim |
| K5 | core | Onayli skill'leri ihtiyaca gore bul ve baglama ekle | K4 | Tum skill'leri her isteme ekleme yok; taint/mahremiyet/butce |
| K6 | ui-theia | Hangi skill ve hafiza kaynaginin kullanildigini goster | K5 | Kaynagi ac/kaldir, bulunamadi/acik durumlari |

F1-F7 mevcut Phase 5 kullanilabilirlik hedefidir. P1-P5 onaylanmis ADR-174'ün
kalan uygulamasidir, yeni engine karari degildir. C1-C3 ADR-182 kapsaminda
onaylandi. C4-C5 ADR-183 kapsaminda onaylandi. T/G satirlari kendi karar
onayindan once kodlanmaz.

## Phase 6 Icin Ayri Onay

Asagidakiler kaynak repolarda yararli olsa da mevcut ROADMAP uyarinca su an
uygulanabilir sayilmaz. Kullanici bunlari Phase 5'e almak isterse ayri ADR ve
roadmap degisikligi gerekir.

| Alan | Paket sirasi | Karar/kabul siniri |
| --- | --- | --- |
| Replay ve zaman cizelgesi | ui-studio fold -> ui-theia -> desktop | Salt okunur; replay tool/model calistirmaz; hiz ve seek deterministik |
| Zaman/dosya/issue/webhook tetikleyicileri | contracts -> kernel/core -> CLI -> UI | Idempotency, auth, geciken isler, kota ve onay davranisi |
| Retrospective, konsolidasyon, ogrenen router | knowledge -> core -> UI | Kanit/kaynak, human override, rollback ve butce |
| Opsiyonel CrewAI/MetaGPT/ChatDev motorlari | engines, motor basina ayri dilimler | Desteklenen alan matrisi; sessiz skip yok; butun model/tool cagrilari gateway/policy |
| Tab completion ve inline AI edit | contracts -> gateway -> ui-theia | Opt-in, iptal, gec cevap, dosya mahremiyeti ve kota |
| Knowledge graph UI | knowledge query -> ui-theia | Kaynak dugumler, yanlis iliski iddiasi yok, buyuk grafik performansi |

## Isletim ve Kabul

Lead kararlar, ortak dosyalar ve entegrasyonu sahiplenir. Sol worker'lar ayrik
dosya kumelerinde uygular; en fazla uc acik worker. Guvenlik, concurrency ve
sozlesmeler bagimsiz Astra incelemesinden gecer.

1. Slice icin mevcut source + spec + ilgili test okunur.
2. Regresyonlar yazilir, uygulama tamamlanir; gelistirme arasi tekrarli tum-suite
   calistirmasi yapilmaz.
3. Bir batch bittiginde `pnpm check`, sonra gerekli offline Electron akisi.
4. Test arizasi davranis degisikligi ise once neden bulunur; assertion zayiflatilmaz.
5. Her slice status'u implemented / verified / open olarak guncellenir.

Windows'ta bu calismada paralel Vitest cache kilidi goruldu. Tek seferlik
`TURBO_CONCURRENCY=1` ile ayni `pnpm check` sirali calistirildi; test kapsamindan
hicbir sey cikarilmadi. Paketlenmis uygulama, Linux, signing/update ve gercek
provider kabul kriterleri birim test veya screenshot ile kapatilamaz.

## Onay Noktasi

Onerilen uygulama sirasi: F1-F7 -> P1-P5 -> C1-C5 -> T1-T6 -> G1-G2 -> K1-K6.
Yeni ADR isteyen satirlar kendi karar noktasinda durur. Phase 6 tablosu bu
onayin disindadir; toplu "tum ozellikler var" etiketi kullanilmaz.

## Uygulama Durumu

| Dilim | Sahip | Durum | Dogrulama |
| --- | --- | --- | --- |
| F1 | Lead | verified | VSIX install/command/disable/enable/uninstall; registry istegi yok |
| F2 | Sol UI | verified | 700/1366, uc tema, uzun input, klavye gonderimi ve screenshot incelemesi |
| F3 | Sol tools | verified | Scope/draft/read-failure unit testleri; save/connect Electron; Astra incelemesi |
| F4 | Lead | verified | Editor/search/terminal/SCM; profil secen komut duzeltildikten sonra tek tekrar gecti |
| F5 | Sol team | verified | Gelismis ayarlar, YAML sirasi/bilinmeyen alanlar; Electron save/reopen |
| F6 | Lead | verified | Yerel Node breakpoint, degisken 40 -> 42, devam sonucu 43 |
| F7 | Lead | verified | Problem matcher -> kaynak -> basarili rerun; eski marker temizlendi |
| P1 | Sol core + Lead | verified (queries only) | Bounded sorgu tool/model overlap, pause/cancel/drain/taint; core 404 test |
| P2 | Sol core/tools + Lead | verified (Windows) | ADR-181 native FS/checkpoint kimligi; core 474, tools 191 test; bilinmeyen etkiler sirali |
| P3 | Sol core + Lead | verified | Onay sirali kuyruk; SQLite restore ve engine restart/retry, fake VCS hatasi |
| P4 | Sol core/security + Lead | verified (Windows) | Exact task/request, aktif karar ve kalicilik regresyonlari; security 114, core 474 test; bagimsiz inceleme kapandi |
| P5 | Sol UI + Lead | verified (Windows Electron) | Goreve ozel izin/onay/geri bildirim, uc tema 700/1366; Home yalniz dogru panele yonlendirir |
| C1 | Lead | verified (Windows) | conversation.thread@1, protokol31, eski portlar korunur; contracts 256 test |
| C2 | Sol core + Lead | verified (Windows) | Atomik kayit/receipt, stale head, silme/arama yarislari ve iki crash-image siniri; core 498 test |
| C3 | Sol UI + Lead | verified (Windows Electron) | Tek sohbet satiri, arama/gecmis, gercek uygulama yeniden baslatma; UI 722 test |
| C4 | Lead + Sol core/tools | verified (Windows) | ADR-183 versioned snapshots, guarded sources, atomic retries; contracts 262, core 528, tools 239 passed / 2 platform skip |
| C5 | Sol UI + Lead | verified (Windows Electron) | Unsaved selection/file, preview/update/remove, restart, four expanded previews and keyboard scroll; UI 765 tests, 2 final Electron scenarios |

P2/P4/P5 kararlari ADR-181 ve S1-S12 olarak 2026-11-07'de onaylandi;
`docs/superpowers/plans/2026-11-07-parallel-control-bounded-slices.md` alt
dilimleri tamamlandi. `mayWrite=false` halen yan etkisiz sorgu anlamina gelmez.
Yeni kanitlar ve acik platform/release sinirlari:
`docs/reviews/2026-11-07-parallel-control.md`.
C1-C3 icin ADR-182 uygulama kaniti:
`docs/reviews/2026-11-07-conversation-threads.md`.
C4-C5 ADR-183 ile onaylandi; uygulama ve kanit durumu
`docs/superpowers/plans/2026-11-07-editor-context.md` ve
`docs/reviews/2026-11-07-editor-context.md` icindedir. Windows source-built
kabul tamamlandi; Linux, paketli release ve gercek provider kabul degildir.
T/G/K ve Phase 6 karar sinirlari degismedi.

Onceki calismanin degisiklikleri korunur. Bu devamda da commit/push yoktur.
