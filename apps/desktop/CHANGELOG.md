# Changelog

## [0.27.0](https://github.com/arcboxlabs/linkcode/compare/v0.26.1...v0.27.0) (2026-08-27)


### Features

* **providers:** resolve LinkCode Gateway as a Codex-native endpoint ([#477](https://github.com/arcboxlabs/linkcode/issues/477)) ([a79b917](https://github.com/arcboxlabs/linkcode/commit/a79b91709eef28386e1618afd2ffdec110f99ebe))


### Bug Fixes

* **client-core:** keep image prompts in place ([#464](https://github.com/arcboxlabs/linkcode/issues/464)) ([d46d560](https://github.com/arcboxlabs/linkcode/commit/d46d5602a106a7bd23497bd3fa267c30fe6aa7f1))

## [0.26.1](https://github.com/arcboxlabs/linkcode/compare/v0.26.0...v0.26.1) (2026-08-26)


### Bug Fixes

* **agent-adapter,engine:** stream codex rollout reads and evict expired history caches ([#466](https://github.com/arcboxlabs/linkcode/issues/466)) ([fedc6ec](https://github.com/arcboxlabs/linkcode/commit/fedc6ec6ff505ded1dbeabea9bcd818b7a998ffb))
* **pi:** preserve account model IDs with slashes ([#471](https://github.com/arcboxlabs/linkcode/issues/471)) ([6bb0633](https://github.com/arcboxlabs/linkcode/commit/6bb0633a5edbffe61b4244fa34b73179bd42b175))

## [0.26.0](https://github.com/arcboxlabs/linkcode/compare/v0.25.2...v0.26.0) (2026-08-24)


### Features

* **settings:** add usage and billing balance ([#468](https://github.com/arcboxlabs/linkcode/issues/468)) ([5d2e3a4](https://github.com/arcboxlabs/linkcode/commit/5d2e3a41cae2aae70489672d66594b9d6b305a77))


### Bug Fixes

* **i18n:** normalize CJK punctuation and fix tracking-widest on zh-CN group labels ([#467](https://github.com/arcboxlabs/linkcode/issues/467)) ([63b3813](https://github.com/arcboxlabs/linkcode/commit/63b3813061b1676418a525d8885cbe69aeaaf2b2))
* **ui:** use official agent icons ([#475](https://github.com/arcboxlabs/linkcode/issues/475)) ([1fb2a9b](https://github.com/arcboxlabs/linkcode/commit/1fb2a9b6ed2d8fbaa61eac7b5d4cb90535760df9))

## [0.25.2](https://github.com/arcboxlabs/linkcode/compare/v0.25.1...v0.25.2) (2026-08-21)


### Bug Fixes

* **attachments:** preserve original image filenames ([#463](https://github.com/arcboxlabs/linkcode/issues/463)) ([c5e864b](https://github.com/arcboxlabs/linkcode/commit/c5e864bc9742629af0907c48add1ecff1567c713))
* **engine:** reach model endpoints through fake-IP tunnels ([f382df6](https://github.com/arcboxlabs/linkcode/commit/f382df6a45222c8a4939bfc503494f21c3b8141d))

## [0.25.1](https://github.com/arcboxlabs/linkcode/compare/v0.25.0...v0.25.1) (2026-08-20)


### Bug Fixes

* **assets:** update aigateway to 0.6.0 ([#461](https://github.com/arcboxlabs/linkcode/issues/461)) ([5673022](https://github.com/arcboxlabs/linkcode/commit/56730223e541c976faf6f2fd93b1449988be8029))

## [0.25.0](https://github.com/arcboxlabs/linkcode/compare/v0.24.0...v0.25.0) (2026-08-20)


### Features

* **providers:** allow ordering accounts and selecting default models ([#459](https://github.com/arcboxlabs/linkcode/issues/459)) ([e57e4ab](https://github.com/arcboxlabs/linkcode/commit/e57e4ab6cb8948ac9392d83083fd915e6e8e9d4e))


### Bug Fixes

* **release:** preserve reviewed legacy destinations ([#448](https://github.com/arcboxlabs/linkcode/issues/448)) ([4e710cd](https://github.com/arcboxlabs/linkcode/commit/4e710cd6f6c1ffe2c1ea051c73eee62ef49b3c1f))
* **workbench:** hide disabled harnesses from new tasks ([#460](https://github.com/arcboxlabs/linkcode/issues/460)) ([03a6b01](https://github.com/arcboxlabs/linkcode/commit/03a6b01b72acf0e084481881f6f74aa19cf3037b))
* **workbench:** require models when adding providers ([#458](https://github.com/arcboxlabs/linkcode/issues/458)) ([41c4fde](https://github.com/arcboxlabs/linkcode/commit/41c4fde9711dbe07676a423175ced788b8a21fed))

## [0.24.0](https://github.com/arcboxlabs/linkcode/compare/v0.23.1...v0.24.0) (2026-08-17)


### Features

* **providers:** add StepFun API support ([#456](https://github.com/arcboxlabs/linkcode/issues/456)) ([c4a2e49](https://github.com/arcboxlabs/linkcode/commit/c4a2e496d0bec512ebb5cf24f0fd17a1a7549480))


### Bug Fixes

* prevent daemon fsync crash and Pi catalog failures ([#454](https://github.com/arcboxlabs/linkcode/issues/454)) ([964f04c](https://github.com/arcboxlabs/linkcode/commit/964f04cf87a6aa8a701836ef6c6b851b57cfe031))

## [0.23.1](https://github.com/arcboxlabs/linkcode/compare/v0.23.0...v0.23.1) (2026-08-17)


### Bug Fixes

* **billing:** hand off billing to hosted console ([#408](https://github.com/arcboxlabs/linkcode/issues/408)) ([b72ba7c](https://github.com/arcboxlabs/linkcode/commit/b72ba7c1569a8d1f6cd8d1ede1390539a0203469))

## [0.23.0](https://github.com/arcboxlabs/linkcode/compare/v0.22.0...v0.23.0) (2026-08-17)


### Features

* **agent-adapter,ui:** surface codex skill brand icons and display names in the command catalog ([#431](https://github.com/arcboxlabs/linkcode/issues/431)) ([6785d25](https://github.com/arcboxlabs/linkcode/commit/6785d25740017bf6bf77c798c49cc9c2f3fbb117))
* **config:** generate branded desktop and mobile identity ([#428](https://github.com/arcboxlabs/linkcode/issues/428)) ([a50ea0f](https://github.com/arcboxlabs/linkcode/commit/a50ea0fe2701748bd44ba309207c62ddd0c6a821))
* **providers,schema,engine,workbench:** retire the default model — user-selected model sets from provider model lists ([#426](https://github.com/arcboxlabs/linkcode/issues/426)) ([084933c](https://github.com/arcboxlabs/linkcode/commit/084933c68f4d31f8e50bfc7d2996d3d4fef89184))
* **release:** add provenance verification CLI ([cc51e0b](https://github.com/arcboxlabs/linkcode/commit/cc51e0bf85b021264bb2628da80e08eb30bd8d2d))
* **release:** bind artifact provenance ([047c5b9](https://github.com/arcboxlabs/linkcode/commit/047c5b9b68fb75172e20f011650659d08dd1d52b))
* **release:** build isolated brand matrix ([7a1ec14](https://github.com/arcboxlabs/linkcode/commit/7a1ec14be9a2245a5427167374044b865d78e6e9))
* **release:** consume rendered brand artifacts ([44bcf67](https://github.com/arcboxlabs/linkcode/commit/44bcf678797ad2ae088523847330451adea15ad8))
* **release:** download deployed config inputs ([d2aaa5f](https://github.com/arcboxlabs/linkcode/commit/d2aaa5ffe26ef83b674fe1d013e0ba40d3848b0c))
* **release:** enforce store configuration compliance ([42a825b](https://github.com/arcboxlabs/linkcode/commit/42a825bd043337b82dbdce06eb66c40e296252b4))
* **release:** gate matrix publication ([dd29699](https://github.com/arcboxlabs/linkcode/commit/dd296991cc11d15cf85c53583a42eefdf1f12dab))
* **release:** render independent config source ([7c98411](https://github.com/arcboxlabs/linkcode/commit/7c984113dd78a65eed92c77a330d0d968ac8678a))
* **release:** validate brand build matrix ([d6817d6](https://github.com/arcboxlabs/linkcode/commit/d6817d6d08f744a0a4cdd5be161dc2451ebc96b0))
* **release:** validate protected release inputs ([e1d037f](https://github.com/arcboxlabs/linkcode/commit/e1d037fac464d3381e44a273e9406738c184d1e7))
* **ui:** dedicated chat components for tool search/select/query ([#430](https://github.com/arcboxlabs/linkcode/issues/430)) ([8a84396](https://github.com/arcboxlabs/linkcode/commit/8a84396eccb580f6c11209b34a7661dc91e8cc78))


### Bug Fixes

* **agent-adapter:** replay codex code-mode MCP calls, Script envelopes, and skill rows ([#435](https://github.com/arcboxlabs/linkcode/issues/435)) ([a2b4e73](https://github.com/arcboxlabs/linkcode/commit/a2b4e7331375df998f52761a223971b539e7fdbe))
* **config:** allow disabled emergency delivery ([6ea7f73](https://github.com/arcboxlabs/linkcode/commit/6ea7f73549503a58e0390ec660b386e7bf516211))
* **release:** bind mobile observer identity ([547ff17](https://github.com/arcboxlabs/linkcode/commit/547ff17e44659167f4d8ede5dd34e2dee0941e7d))
* **release:** close privileged workflow paths ([7c32c92](https://github.com/arcboxlabs/linkcode/commit/7c32c925588f4d611cf04bf0b06bd02b2a465126))
* **release:** decouple client build from config publication ([e79cbf3](https://github.com/arcboxlabs/linkcode/commit/e79cbf3c0ac0fea8d3366890397214a6c39b1ff9))
* **release:** harden brand matrix trust ([8bf90cb](https://github.com/arcboxlabs/linkcode/commit/8bf90cbec2c73cba64144d7400fec00a5847be6c))
* **release:** harden pilot matrix gates ([856c199](https://github.com/arcboxlabs/linkcode/commit/856c199ed00e2aa1ecfbf5404b45306d93c5bc07))
* **release:** normalize JSON environment inputs ([55b8518](https://github.com/arcboxlabs/linkcode/commit/55b8518d22feb76204a15d68d7ad542a2f9d6fbe))
* **release:** require observed config publication ([5f8ed5e](https://github.com/arcboxlabs/linkcode/commit/5f8ed5e714b4a5558c19256218a66bce544bc5d1))
* **release:** require observed config publication ([#451](https://github.com/arcboxlabs/linkcode/issues/451)) ([7677211](https://github.com/arcboxlabs/linkcode/commit/7677211937cfa197c244df366a55474ac94b3929))
* **release:** select both config repositories ([f91fcbe](https://github.com/arcboxlabs/linkcode/commit/f91fcbe0d850084edee35f9f587fe13d154cd884))
* **release:** unify target identity contract ([5d6f81b](https://github.com/arcboxlabs/linkcode/commit/5d6f81bd781cea6bdd561a9ac896959b203b2601))
* **release:** use protected release environment ([8a19b05](https://github.com/arcboxlabs/linkcode/commit/8a19b0591f8dbe32c8691554b36768fd0693f162))
* **ui:** tighten grouped activity spacing ([#446](https://github.com/arcboxlabs/linkcode/issues/446)) ([65f16cf](https://github.com/arcboxlabs/linkcode/commit/65f16cf1bd252ee169f64dea6bfdbd45cf7c7192))

## [0.22.0](https://github.com/arcboxlabs/linkcode/compare/v0.21.0...v0.22.0) (2026-08-06)


### Features

* **providers:** resolve provider endpoints per agent ([#424](https://github.com/arcboxlabs/linkcode/issues/424)) ([cd67dd9](https://github.com/arcboxlabs/linkcode/commit/cd67dd9f5d0d5d9d159944dccb30420949bd4781))


### Bug Fixes

* **lint:** run single-threaded by default and share one command with CI ([#416](https://github.com/arcboxlabs/linkcode/issues/416)) ([1fb5474](https://github.com/arcboxlabs/linkcode/commit/1fb54744463de92b050b0cc881376c633947943a))

## [0.21.0](https://github.com/arcboxlabs/linkcode/compare/v0.20.0...v0.21.0) (2026-08-05)


### Features

* **config:** add shared configuration core ([#404](https://github.com/arcboxlabs/linkcode/issues/404)) ([7382ad5](https://github.com/arcboxlabs/linkcode/commit/7382ad502153cb006e7c17a2adb339f9c4c3ffb8))
* **config:** build-time immutable per-target bootstrap and bundled defaults (CODE-552) ([#413](https://github.com/arcboxlabs/linkcode/issues/413)) ([429a02c](https://github.com/arcboxlabs/linkcode/commit/429a02c110aa592768734651388f645197f1dfe7))
* **config:** consent-gated authenticated publication telemetry (CODE-555 client) ([#417](https://github.com/arcboxlabs/linkcode/issues/417)) ([48afdd5](https://github.com/arcboxlabs/linkcode/commit/48afdd54bbd1760b4d84cecd9cd1db3d2b4f3973))
* **config:** emergency client runtime (CODE-554) ([#420](https://github.com/arcboxlabs/linkcode/issues/420)) ([5d365a9](https://github.com/arcboxlabs/linkcode/commit/5d365a95fe8dbd3baad518e46416ddd42c4d2fdd))
* **desktop:** integrate verified config bootstrap and LKG ([#410](https://github.com/arcboxlabs/linkcode/issues/410)) ([832a746](https://github.com/arcboxlabs/linkcode/commit/832a746431fe2a1f3a88706dc5cf11863f28eecb))
* **mobile:** integrate shared configuration core ([#409](https://github.com/arcboxlabs/linkcode/issues/409)) ([f858e8a](https://github.com/arcboxlabs/linkcode/commit/f858e8abedf4c3e61b71fa2a9054b275f76d5e47))
* **schema:** define LinkCode marketplace contracts ([#403](https://github.com/arcboxlabs/linkcode/issues/403)) ([482c3bd](https://github.com/arcboxlabs/linkcode/commit/482c3bd48333e3756392525c8633ec0270f9c85a))
* **schema:** define LinkCode plugin package contracts ([#400](https://github.com/arcboxlabs/linkcode/issues/400)) ([e95bb08](https://github.com/arcboxlabs/linkcode/commit/e95bb086f444a1731878f299e15d41d36f2bc908))
* **ui:** rework model selector menu ([#415](https://github.com/arcboxlabs/linkcode/issues/415)) ([2d4d987](https://github.com/arcboxlabs/linkcode/commit/2d4d9872b7265ad7d2f21dee7c2a7c0c3d3daab1))


### Bug Fixes

* **workbench:** isolate identity-scoped cache data ([#412](https://github.com/arcboxlabs/linkcode/issues/412)) ([03cc288](https://github.com/arcboxlabs/linkcode/commit/03cc288b0588f0ec32a3ee6c1aab5b4cea43355c))

## [0.20.0](https://github.com/arcboxlabs/linkcode/compare/v0.19.0...v0.20.0) (2026-08-03)


### Features

* **history:** rewrite prompts while agents run ([#406](https://github.com/arcboxlabs/linkcode/issues/406)) ([de0145f](https://github.com/arcboxlabs/linkcode/commit/de0145f5a97ad918e38171873f959cead0d37e85))


### Bug Fixes

* **agent-adapter:** sync provider session titles ([#405](https://github.com/arcboxlabs/linkcode/issues/405)) ([7658ae1](https://github.com/arcboxlabs/linkcode/commit/7658ae1203a3f153f11f9848bd852b880d392d00))

## [0.19.0](https://github.com/arcboxlabs/linkcode/compare/v0.18.2...v0.19.0) (2026-08-02)


### Features

* **mobile:** polish terminal inbox ([#382](https://github.com/arcboxlabs/linkcode/issues/382)) ([9fe21a1](https://github.com/arcboxlabs/linkcode/commit/9fe21a18bcf9fb1a3802e097720d4d6d7fcfe73f))
* **mobile:** polish unreachable host state ([#387](https://github.com/arcboxlabs/linkcode/issues/387)) ([e8bd4d4](https://github.com/arcboxlabs/linkcode/commit/e8bd4d4ffdbad634100133ebec2eb59ff8d07b34))


### Bug Fixes

* **chat:** render selected conversation on first paint ([#390](https://github.com/arcboxlabs/linkcode/issues/390)) ([bb2d509](https://github.com/arcboxlabs/linkcode/commit/bb2d50941ebad7b74500f686977914d9356a151f))
* **mobile:** detect metadata upload failures ([a1c30c4](https://github.com/arcboxlabs/linkcode/commit/a1c30c45af8d190ab6a407af04ae6365fadca69f))

## [0.18.2](https://github.com/arcboxlabs/linkcode/compare/v0.18.1...v0.18.2) (2026-08-01)


### Bug Fixes

* **chat:** make smooth conversation follow opt-in ([#385](https://github.com/arcboxlabs/linkcode/issues/385)) ([4cac29e](https://github.com/arcboxlabs/linkcode/commit/4cac29e49b670a161cc0083344174b3a985a51bd))
* **mobile:** install dependencies before metadata push ([771933c](https://github.com/arcboxlabs/linkcode/commit/771933c6491d7b9653e1b514a8384adabdb1e355))
* **mobile:** provide Apple team to metadata push ([6c6f67d](https://github.com/arcboxlabs/linkcode/commit/6c6f67dfd146c074f171404908cf39381fbab410))
* **mobile:** reuse pnpm EAS setup ([f0c0549](https://github.com/arcboxlabs/linkcode/commit/f0c05495ba22afafb2ae35ffeb024491d1eee781))

## [0.18.1](https://github.com/arcboxlabs/linkcode/compare/v0.18.0...v0.18.1) (2026-08-01)


### Bug Fixes

* **webview:** restore conversation virtualization ([#380](https://github.com/arcboxlabs/linkcode/issues/380)) ([4833c3d](https://github.com/arcboxlabs/linkcode/commit/4833c3d75652c5ac92c1bef18505fe3dc679364b))

## [0.18.0](https://github.com/arcboxlabs/linkcode/compare/v0.17.0...v0.18.0) (2026-08-01)


### Features

* **desktop,agent-adapter:** API-key / relay login on the signed-out agent card ([#350](https://github.com/arcboxlabs/linkcode/issues/350)) ([39298ae](https://github.com/arcboxlabs/linkcode/commit/39298ae05a8e819da6cf7ef4548efd2e886816c6))
* **git:** add local branch workflows to new sessions ([7a023ef](https://github.com/arcboxlabs/linkcode/commit/7a023ef818bf621e62e99507de82182a6450dcc2))
* **git:** add local branch workflows to new sessions ([#376](https://github.com/arcboxlabs/linkcode/issues/376)) ([200753c](https://github.com/arcboxlabs/linkcode/commit/200753c604c6a6d96ff6d66f500035cf1681bde2))


### Bug Fixes

* **desktop:** offer the install when an update is already downloaded ([#377](https://github.com/arcboxlabs/linkcode/issues/377)) ([870e1c5](https://github.com/arcboxlabs/linkcode/commit/870e1c5dedd4d92e942f613393cd3c83c5862461))
* **devenv:** strip nix toolchain env from the mobile script ([d0c4894](https://github.com/arcboxlabs/linkcode/commit/d0c4894ef55934898991bc27623bf9c7355c998b))
* **providers:** authenticate subscription accounts ([8f6a3ab](https://github.com/arcboxlabs/linkcode/commit/8f6a3abba0a337900586c83499b126a5c5a13220))
* **settings:** open provider service catalog directly ([6a43d51](https://github.com/arcboxlabs/linkcode/commit/6a43d517e5b3f7fb988abfadb06b60c1b26a63b9))
* **ui:** prevent branch search text overlap ([91ccfb5](https://github.com/arcboxlabs/linkcode/commit/91ccfb5ef60bed43fb1dc3c84af4a25a5532b6fa))
* **workbench:** preserve subscription login state ([9f88a5c](https://github.com/arcboxlabs/linkcode/commit/9f88a5c0929a72b504552ba6a225b6c993554d9f))
* **workbench:** route signed-out setup through providers ([f1839d1](https://github.com/arcboxlabs/linkcode/commit/f1839d151f765f4e0f2909cf1033ef362d4f48c1))
* **workbench:** support completable agent logins ([3cbd825](https://github.com/arcboxlabs/linkcode/commit/3cbd825e8128f7913f79015e4be9c9b6d788d149))

## [0.17.0](https://github.com/arcboxlabs/linkcode/compare/v0.16.0...v0.17.0) (2026-08-01)


### Features

* **plugins:** plugins, MCP, and skills management on the provider-plugin model ([#344](https://github.com/arcboxlabs/linkcode/issues/344)) ([cc7ca6c](https://github.com/arcboxlabs/linkcode/commit/cc7ca6c786574295ed30150c4225d47a540d6696))

## [0.16.0](https://github.com/arcboxlabs/linkcode/compare/v0.15.1...v0.16.0) (2026-08-01)


### Features

* **agent-adapter:** report each agent's configured default model and effort ([9aab5dc](https://github.com/arcboxlabs/linkcode/commit/9aab5dc240a188b5bc412c1bf20f04f7e58e0b13))
* **desktop:** show update download progress ([#362](https://github.com/arcboxlabs/linkcode/issues/362)) ([9fe3aa8](https://github.com/arcboxlabs/linkcode/commit/9fe3aa8b3d954e65fbe417505749f0074e70d9af))
* **resources:** show current plan in panel ([#358](https://github.com/arcboxlabs/linkcode/issues/358)) ([a0a7aab](https://github.com/arcboxlabs/linkcode/commit/a0a7aabe11c2c0648b2f832fbc1c9fae8ffb4ee5))
* **schema:** carry the agent's own default model and effort in the start catalog ([0c6c7ee](https://github.com/arcboxlabs/linkcode/commit/0c6c7ee237e4ddce3cb3d2139c1c6456dd8e527b))
* **ui:** prefer the agent's configured default over the built-in model guess ([b72a1aa](https://github.com/arcboxlabs/linkcode/commit/b72a1aa2a55b75ef3d1dafacf12100506f9642c7))


### Bug Fixes

* **agent-adapter:** read codex config.toml from the app-server environment ([9f3161d](https://github.com/arcboxlabs/linkcode/commit/9f3161da623341f81212222c76a121c97bee867e))
* **daemon:** bound AI gateway startup ([00608da](https://github.com/arcboxlabs/linkcode/commit/00608da8cac6894a3b0383c103ad2fc530f5b53a))
* **ui:** keep a catalog effort with the model it belongs to ([f8cf515](https://github.com/arcboxlabs/linkcode/commit/f8cf515a955e670326bc06d367f79c52943d6546))
* **ui:** preserve local font query receiver ([b6a5faa](https://github.com/arcboxlabs/linkcode/commit/b6a5faaa69dbd4451fc65a0cbcff2b7cea401561))

## [0.15.1](https://github.com/arcboxlabs/linkcode/compare/v0.15.0...v0.15.1) (2026-08-01)


### Bug Fixes

* **composer:** enforce shell directive grammar ([35a3a05](https://github.com/arcboxlabs/linkcode/commit/35a3a0577f35c32c4832af265b8cdb366fdfe514))
* **composer:** require shell directive separator ([d6bd22d](https://github.com/arcboxlabs/linkcode/commit/d6bd22d4120b5bc93a1022f919199941bfbd4c0b))
* **ui:** align inline code position ([05a91ec](https://github.com/arcboxlabs/linkcode/commit/05a91ecd03bb7d984a99ad43cf32eaf4c709818e))
* **ui:** tolerate generic keydown events ([24ca677](https://github.com/arcboxlabs/linkcode/commit/24ca67770ded46f048b6ee944d669291f2857aa6))

## [0.15.0](https://github.com/arcboxlabs/linkcode/compare/v0.14.0...v0.15.0) (2026-07-31)


### Features

* **chat:** add conversation minimap geometry ([ab99e29](https://github.com/arcboxlabs/linkcode/commit/ab99e29f3909b98c2aa9224712934ff4465d610f))
* **chat:** add the conversation minimap rail ([5553c1c](https://github.com/arcboxlabs/linkcode/commit/5553c1c5f6ca964564b1ea9f1fc0d04ab0cd343c))
* **chat:** expose the conversation virtualizer handle ([8c9aa77](https://github.com/arcboxlabs/linkcode/commit/8c9aa777e990e28fd16261b8486f02786496a39b))
* **mock:** seed a long thread in the dev mock host ([d72b564](https://github.com/arcboxlabs/linkcode/commit/d72b564be88109985a8446d99d341166aad2d470))


### Bug Fixes

* **chat:** steady the minimap rail and its keyboard path ([6e27750](https://github.com/arcboxlabs/linkcode/commit/6e27750824e828afe40b5baedba4aa4358ed04c2))
* **chat:** tune the minimap rail down to its quiet form ([4726df8](https://github.com/arcboxlabs/linkcode/commit/4726df8b56f9d5a19c8ec9e42ef9e56d4b6b46a5))
* **desktop:** keep the sidebar translucent over the native backdrop ([#360](https://github.com/arcboxlabs/linkcode/issues/360)) ([70b50b6](https://github.com/arcboxlabs/linkcode/commit/70b50b626b55bfca3bc8c61064ed1864de55b41c))

## [0.14.0](https://github.com/arcboxlabs/linkcode/compare/v0.13.0...v0.14.0) (2026-07-31)


### Features

* **desktop:** add update polling and sidebar prompt ([adda937](https://github.com/arcboxlabs/linkcode/commit/adda937f9d06acf59daa3121b1c587fc2b2e707c))


### Bug Fixes

* **desktop:** settle inactive update checks ([78a99d3](https://github.com/arcboxlabs/linkcode/commit/78a99d33cbacb339f7ba0739993f7390978c0f88))
* **release:** install both CPU keyring bindings ([0bddfce](https://github.com/arcboxlabs/linkcode/commit/0bddfce101d5385d78413bf2210711bcdc8fb4df))
* **release:** keep builder Linux output layouts ([524b76e](https://github.com/arcboxlabs/linkcode/commit/524b76ecd09f009c7f4833979a22c4bc661b23a7))
* **release:** let staging select builder architecture ([24bd573](https://github.com/arcboxlabs/linkcode/commit/24bd573df48eb15273671e4ba1c9554d1dd4ee8b))
* **release:** stage desktop dependencies per architecture ([735a232](https://github.com/arcboxlabs/linkcode/commit/735a232fdbb77cb97e8a05bd7873f5d6301c5350))
* **ui,workbench,desktop,webview:** swap the thread-title view transition for a header enter animation ([#354](https://github.com/arcboxlabs/linkcode/issues/354)) ([fe034b7](https://github.com/arcboxlabs/linkcode/commit/fe034b71cff65e648d94a8bfb18b4f089e9e066a))

## [0.13.0](https://github.com/arcboxlabs/linkcode/compare/v0.12.0...v0.13.0) (2026-07-31)


### Features

* **daemon:** add an OS-keyring-backed secret vault ([0f8d73c](https://github.com/arcboxlabs/linkcode/commit/0f8d73cc160789489859facdf95d35c70c782d63))
* **daemon:** hold the software device key in the secret vault ([9a54fb4](https://github.com/arcboxlabs/linkcode/commit/9a54fb4a21608bdfe1f5c42250def654193626ab))
* **daemon:** move provider and account credentials into the secret vault ([b0046e9](https://github.com/arcboxlabs/linkcode/commit/b0046e98561a4282ae784430bbbf04ddc64932b4))
* **daemon:** move the HQ session token into the secret vault ([c37d656](https://github.com/arcboxlabs/linkcode/commit/c37d656e7056eb6eb58c3692abe59eac6cc4afec))
* **daemon:** treat a non-durable keyring as no keyring ([7cea81d](https://github.com/arcboxlabs/linkcode/commit/7cea81d83fe0062af7fb56c06eff0378dab2942a))
* **mobile:** conversation interaction on @expo/ui — prompt dock, tool-detail sheet, theming (CODE-196) ([#315](https://github.com/arcboxlabs/linkcode/issues/315)) ([d094e68](https://github.com/arcboxlabs/linkcode/commit/d094e6878f60ff2f0439e2c92e0a58c8b7529576))
* **resources:** add resource service ([db6349f](https://github.com/arcboxlabs/linkcode/commit/db6349fbb2774ddeaac42ef7b9d7c4aea4a527b6))
* **resources:** add resource wire operations ([66e942a](https://github.com/arcboxlabs/linkcode/commit/66e942ae0698b583004d53fb16d335e7d696c12a))
* **resources:** add shared resources panel ([93bb9f6](https://github.com/arcboxlabs/linkcode/commit/93bb9f65bd7cc36fb95092da0a613fd1dd10631d))
* **resources:** add task resources panel ([#339](https://github.com/arcboxlabs/linkcode/issues/339)) ([61dcf83](https://github.com/arcboxlabs/linkcode/commit/61dcf833a6f3c51bfa66c652f283b100f4adc0f3))
* **resources:** bind panel to session resources ([75f8756](https://github.com/arcboxlabs/linkcode/commit/75f87565973b26e683b6859b280f4295456bb044))
* **resources:** connect session resource flow ([f684d34](https://github.com/arcboxlabs/linkcode/commit/f684d34b092d7085fad58a9bcb9d74cde41da012))
* **resources:** integrate desktop and web panels ([80c97ae](https://github.com/arcboxlabs/linkcode/commit/80c97ae614b7c28f291797263aaeeb85ee6982a2))
* **resources:** persist daemon resources ([f87f346](https://github.com/arcboxlabs/linkcode/commit/f87f3466f45df75c4331e887647a0bf2ae9ef5bb))
* **resources:** register agent-used web sources ([60a64b2](https://github.com/arcboxlabs/linkcode/commit/60a64b2c4decd4334a981aa5ab5c35340130b460))
* **schema,engine:** announce persisted session list changes ([d4bc835](https://github.com/arcboxlabs/linkcode/commit/d4bc8358908d72b907ff8d9a1c22f808d1e8a1df))
* **schema,transport,client-core:** exchange wire version ranges at handshake ([3ed7ca9](https://github.com/arcboxlabs/linkcode/commit/3ed7ca903377a93d2beb5de7caadccc806441318))
* **schema,transport:** drop an unknown frame instead of the whole connection ([cd14463](https://github.com/arcboxlabs/linkcode/commit/cd1446362caba8184622d77ef966e11040cf45b5))


### Bug Fixes

* **client-core,mobile:** pick up session list changes from other clients ([13e354f](https://github.com/arcboxlabs/linkcode/commit/13e354f221eca6895218d1c967c5203be32fc4d8))
* **client-core:** let the daemon snapshot replace the session list outright ([619cd61](https://github.com/arcboxlabs/linkcode/commit/619cd611ebdc9a758f1f292e97d8cc61b1d6c679))
* **code-282:** ensure scroll to bottom ([7c8c627](https://github.com/arcboxlabs/linkcode/commit/7c8c627bc3862aab02d667b6d60ab4da552d4f84))
* **daemon:** distinguish a missing device-key binding from absent hardware ([cfe44de](https://github.com/arcboxlabs/linkcode/commit/cfe44de97ecf325a83cc8ab0884e34f146224c66))
* **daemon:** sweep the legacy device key at boot, not on the uplink path ([636035f](https://github.com/arcboxlabs/linkcode/commit/636035f93f7ec685651ac7d8fd9db1538252ba87))
* **desktop:** fail closed when the OS cannot protect the cloud session ([72efdb5](https://github.com/arcboxlabs/linkcode/commit/72efdb594c8c55f69a011fdbbf60e76d6d5a2b3b))
* **resources:** anchor constrained panel to trigger ([07fcedc](https://github.com/arcboxlabs/linkcode/commit/07fcedc60dddb37081cc81f08f06baa8c5ea6b48))
* **resources:** keep composer aligned ([df5256d](https://github.com/arcboxlabs/linkcode/commit/df5256d7c284ea4268cfc43be0f89e584d8f9d41))
* **resources:** preserve balanced conversation layout ([2167c67](https://github.com/arcboxlabs/linkcode/commit/2167c67f9ea95dd91c1a200b88e3e4767c68839c))
* **resources:** preserve content width in floating mode ([d7fbce8](https://github.com/arcboxlabs/linkcode/commit/d7fbce8b49129ea315121bf1fe52062daf97ac5f))
* **resources:** reserve space for wide panel ([6038e71](https://github.com/arcboxlabs/linkcode/commit/6038e71bbdf3a9c6ec33f75865e3d2d7901e07e1))
* **resources:** sanitize injected source history ([5984456](https://github.com/arcboxlabs/linkcode/commit/59844567e3cd551813d6ddb6d2b2c509d69cd110))
* **resources:** size floating card to content ([d241562](https://github.com/arcboxlabs/linkcode/commit/d241562ea1220889240e24c51bb27db2f16aa51a))
* **resources:** unify floating rail background ([b389a67](https://github.com/arcboxlabs/linkcode/commit/b389a670f1fcf136785b837735faaf4d8c5d5188))
* **resources:** use dialog when side space is constrained ([db8fc41](https://github.com/arcboxlabs/linkcode/commit/db8fc41e49be13c8bdccaf60c36603ca52041750))

## [0.12.0](https://github.com/arcboxlabs/linkcode/compare/v0.11.0...v0.12.0) (2026-07-30)


### Features

* **git,session:** add branch-selected worktree sessions ([#331](https://github.com/arcboxlabs/linkcode/issues/331)) ([1c00df3](https://github.com/arcboxlabs/linkcode/commit/1c00df3bacce970c13a48338e3daa7857ae89f45))


### Bug Fixes

* **daemon:** squash worktree migrations ([e894890](https://github.com/arcboxlabs/linkcode/commit/e894890aa51807a47810af263e1da4172d2f6bfa))

## [0.11.0](https://github.com/arcboxlabs/linkcode/compare/v0.10.1...v0.11.0) (2026-07-30)


### Features

* **pty:** close terminal tabs on process exit ([#338](https://github.com/arcboxlabs/linkcode/issues/338)) ([1e77c38](https://github.com/arcboxlabs/linkcode/commit/1e77c38f6204d1cbf011cc950fdceab12b9cc87e))


### Bug Fixes

* **assets:** version Pi closures by content ([2fdab62](https://github.com/arcboxlabs/linkcode/commit/2fdab62651c1df11c62a454b24ad4279f384b34c))
* **release:** repair Linux desktop cross-architecture builds ([#343](https://github.com/arcboxlabs/linkcode/issues/343)) ([995dcc2](https://github.com/arcboxlabs/linkcode/commit/995dcc2b90e869dd3c864afc5efea1bb466f83e2))

## [0.10.1](https://github.com/arcboxlabs/linkcode/compare/v0.10.0...v0.10.1) (2026-07-30)


### Bug Fixes

* **release:** build Linux native modules with Clang ([5e29a84](https://github.com/arcboxlabs/linkcode/commit/5e29a84c77a3790183fa2c4143ea5462b4ad5074))
* **ui:** i18n for sidebar ([#333](https://github.com/arcboxlabs/linkcode/issues/333)) ([271278b](https://github.com/arcboxlabs/linkcode/commit/271278bc4bd39375cbf5e5527542ee62801c9cb4))
* **ui:** keep permission mode visible on new task ([#336](https://github.com/arcboxlabs/linkcode/issues/336)) ([d0dacea](https://github.com/arcboxlabs/linkcode/commit/d0dacea81366d8fbe9494b4e458c4ebe4560e30a))

## [0.10.0](https://github.com/arcboxlabs/linkcode/compare/v0.9.0...v0.10.0) (2026-07-29)


### Features

* **agent-adapter,engine,daemon:** simulator MCP tools for every MCP-capable agent ([9bf470d](https://github.com/arcboxlabs/linkcode/commit/9bf470d0bb80353d438ca376517fe0cb176f2823))
* **agent-adapter,engine,daemon:** simulator MCP tools for every MCP-capable agent (CODE-395) ([5311e50](https://github.com/arcboxlabs/linkcode/commit/5311e50888864bd14ce0ec40993a81d500007abe))
* **agent-adapter:** advertise approval tiers before session start ([#305](https://github.com/arcboxlabs/linkcode/issues/305)) ([d9b74b0](https://github.com/arcboxlabs/linkcode/commit/d9b74b0c917688a902cc1301df345a3a315dffbd))
* **agent-adapter:** complete opencode and Pi slash commands ([#242](https://github.com/arcboxlabs/linkcode/issues/242)) ([176360d](https://github.com/arcboxlabs/linkcode/commit/176360dcdef610cc5bbf9476ab72ec59bfbc75a9))
* **agent-adapter:** probe and spawn opencode from the resolved binary (CODE-76) ([#244](https://github.com/arcboxlabs/linkcode/issues/244)) ([fda7e09](https://github.com/arcboxlabs/linkcode/commit/fda7e09072fe28be7c9c4f1777797aa64a19a59b))
* **client-core,mobile:** narrow event delivery to attached sessions (CODE-446) ([#325](https://github.com/arcboxlabs/linkcode/issues/325)) ([dbfd932](https://github.com/arcboxlabs/linkcode/commit/dbfd9322d6987acaa3762bb20f2ea28b5a8b325c))
* **client-core,mobile:** scope event delivery to the sessions in view ([01597f6](https://github.com/arcboxlabs/linkcode/commit/01597f67bb1c9a24802ca6687c742054ed64eae0))
* **client-core:** simulator control surface ([e446d1b](https://github.com/arcboxlabs/linkcode/commit/e446d1bdf1bd88d1c65e0d4eb3ab3acfcca4c690))
* **composer:** serialize file mentions as markdown links ([6797c14](https://github.com/arcboxlabs/linkcode/commit/6797c1468e3caa7dc97118a83aae908796132c7b))
* **daemon,desktop:** wire the sim sidecar client into the engine ([0e2e9d1](https://github.com/arcboxlabs/linkcode/commit/0e2e9d10eb8d96a2a913ee1d4b03fe1baa137cc4))
* **daemon:** agent input tools — tap, swipe, text, and named keys ([2f681a0](https://github.com/arcboxlabs/linkcode/commit/2f681a08dd8e6951bc18a39cc91e8fb8a5761170))
* **desktop,ipc,ui:** chrome title overflow menu — thread actions, reveal, open in editor ([#265](https://github.com/arcboxlabs/linkcode/issues/265)) ([a551149](https://github.com/arcboxlabs/linkcode/commit/a55114902d8a1a713f951d34eeaab5003012f021))
* **desktop,ui:** multi-tab Browser panel — tabbed webviews, popup capture, find/zoom/devtools (CODE-266) ([#181](https://github.com/arcboxlabs/linkcode/issues/181)) ([a7c21be](https://github.com/arcboxlabs/linkcode/commit/a7c21be2c3d0e444c91715f9e44b0949b373f2a7))
* **desktop,ui:** simulator as an on-demand right-panel section ([c477228](https://github.com/arcboxlabs/linkcode/commit/c4772289b13b06e172efd897b07fab3d062a6f5c))
* **desktop,workbench,ui:** iOS Simulator panel — on-demand section with live co-driving stream (CODE-397) ([34d0b1b](https://github.com/arcboxlabs/linkcode/commit/34d0b1b6c9a6374ade6b9ecfe9d037c8c508fc37))
* **desktop,workbench:** reveal the simulator section when an agent picks up a device ([9a2357b](https://github.com/arcboxlabs/linkcode/commit/9a2357bc1b9029732db477f0453eb60724ab4036))
* **desktop:** allow google favicon hosts in renderer csp ([771adf9](https://github.com/arcboxlabs/linkcode/commit/771adf9cf784bc44232c18a41eed4a50936759af))
* **engine:** reclaim an idle detached simulator the engine booted ([5963ef5](https://github.com/arcboxlabs/linkcode/commit/5963ef56816f61810f44c392f48ec184c9dcd4c4))
* **engine:** simulator tap/swipe/button + framebuffer stream in the backend port and service ([9257071](https://github.com/arcboxlabs/linkcode/commit/92570716f00c3a43df762c5e35089fc462588d59))
* **engine:** simulator wire request handler ([d2407e1](https://github.com/arcboxlabs/linkcode/commit/d2407e16a5400f2a0ce209620dc881b5e73aca07))
* **engine:** SimulatorBackend port and per-session device registry ([8828cd3](https://github.com/arcboxlabs/linkcode/commit/8828cd3211248925790b523a18a781780b2dcada))
* **mobile:** message composer on the conversation screen ([d9597b9](https://github.com/arcboxlabs/linkcode/commit/d9597b9cdeea68d372432f8d409233a934cfb29c))
* **mobile:** redesign the app on @expo/ui ([#306](https://github.com/arcboxlabs/linkcode/issues/306)) ([04d3207](https://github.com/arcboxlabs/linkcode/commit/04d32077db4abd92921969f76ee3d22b356c4e7d))
* **mobile:** render Settings with @expo/ui ([0dd3fe1](https://github.com/arcboxlabs/linkcode/commit/0dd3fe1de9bb4934287350020a3073e303ea8205))
* **mobile:** render the connect screen with @expo/ui ([f9893c7](https://github.com/arcboxlabs/linkcode/commit/f9893c7d905299c6c4828fd02e58a90cd3b68e10))
* **mobile:** render the terminal list with @expo/ui ([b2477c3](https://github.com/arcboxlabs/linkcode/commit/b2477c36e2bef20d0012e892a462435145649f98))
* **mobile:** restyle the threads inbox after the reference ([c52d77d](https://github.com/arcboxlabs/linkcode/commit/c52d77df1589245ab4f82e8e7616758f14467939))
* **plugins:** discover and aggregate provider plugins ([#272](https://github.com/arcboxlabs/linkcode/issues/272)) ([c9f5f68](https://github.com/arcboxlabs/linkcode/commit/c9f5f68b59a512714006a49f9168485f82b2227d))
* **schema,daemon,desktop:** fork on-disk state by channel ([d373756](https://github.com/arcboxlabs/linkcode/commit/d3737564ae40ad5762f71a9ed31318900c0ab5ab))
* **schema,daemon,ui:** show where an agent is touching the device ([ebe8ead](https://github.com/arcboxlabs/linkcode/commit/ebe8eadda49a9e3399cd59458b8c26f9b64410ca))
* **schema,daemon:** publish the wire protocol version in daemon identity ([2bb27c0](https://github.com/arcboxlabs/linkcode/commit/2bb27c08d95bc9f9c5b57abec0f5cd95b25803de))
* **schema,engine,client-core:** H.264 stream codec plumbing (wire 47) ([4a7e54e](https://github.com/arcboxlabs/linkcode/commit/4a7e54ee50d87162f36518726cee77203171aee2))
* **schema,engine,client-core:** simulator screen-mask wire (wire 46) ([e4e1faf](https://github.com/arcboxlabs/linkcode/commit/e4e1faf683a9b8df1856291564a27f5f55a2f4a4))
* **schema,engine,client-core:** simulator wire contract — availability, device commands, screenshot (CODE-394) ([ebfa242](https://github.com/arcboxlabs/linkcode/commit/ebfa242418b9e4ffc056a61248e0e22e4f8f87ee))
* **schema,engine,daemon:** describe_ui — the guest UI tree as an agent tool ([6bf4297](https://github.com/arcboxlabs/linkcode/commit/6bf429709aa935a4b31cf5c434937244e4dcdc15))
* **schema,engine,daemon:** gate agent simulator tools on per-device consent ([0c19147](https://github.com/arcboxlabs/linkcode/commit/0c1914727bd9250936d6eedc5061e44f73f90797))
* **schema,engine,desktop:** browser broker — wire contract, webview executor, code-mode execute tool for claude/pi (CODE-267) ([#188](https://github.com/arcboxlabs/linkcode/issues/188)) ([3f70dad](https://github.com/arcboxlabs/linkcode/commit/3f70dadfe8b8514b20c25338fa5f078b6facfcb1))
* **schema,transport,engine,client-core:** simulator interactive + stream wire (wire 45) ([4f9ddf2](https://github.com/arcboxlabs/linkcode/commit/4f9ddf2e67e57ec91289dce637d592b60f4c56e6))
* **schema:** add normalized plugin model ([#263](https://github.com/arcboxlabs/linkcode/issues/263)) ([558e6ba](https://github.com/arcboxlabs/linkcode/commit/558e6baf57c0207d464a2e07accfe03a0faaf8da))
* **sim-sidecar:** hardware H.264 streaming via VideoToolbox (zero-copy IOSurface) ([c0aee6d](https://github.com/arcboxlabs/linkcode/commit/c0aee6dfc4e794fd047bbc65d9737a3389f29fdb))
* **sim-sidecar:** screenMask op rendering the devicetype framebuffer mask ([9af3b83](https://github.com/arcboxlabs/linkcode/commit/9af3b834797250075ac41e47ece6f9b96beab742))
* **sim,engine,daemon:** shake a device without reversing the motion payload ([699c4e4](https://github.com/arcboxlabs/linkcode/commit/699c4e41e3fe07b94c6c2c8085f1e4ec91e994b9))
* **sim,engine,workbench:** guide setup instead of reporting simulators unavailable ([e7a6791](https://github.com/arcboxlabs/linkcode/commit/e7a679129f95263621d0e90503fd9449d48fdccc))
* **sim,engine:** @linkcode/sim SDK + SimulatorBackend with per-session device ownership (CODE-393) ([b857f9d](https://github.com/arcboxlabs/linkcode/commit/b857f9d1da78a75746d51287fd0c3c8fe4dbc6a1))
* **sim,schema,engine,client,ui:** streamed touch, wheel scroll, HID keyboard (wire 48) ([09410ba](https://github.com/arcboxlabs/linkcode/commit/09410ba00b1b970d64362874b1a736a32e202a34))
* **sim,schema,engine,client,ui:** two-finger pinch + IME pasteboard input (wire 49) ([e4c6bb4](https://github.com/arcboxlabs/linkcode/commit/e4c6bb4cece6bd0a0c87a810bb0965d0e71f0ead))
* **sim,workbench:** volume-key injection and Simulator.app shortcut parity ([498ec21](https://github.com/arcboxlabs/linkcode/commit/498ec21cf258aaee735037f05dcfe3ee4ef43a92))
* **sim:** @linkcode/sim typed sidecar client ([87d842d](https://github.com/arcboxlabs/linkcode/commit/87d842d54fb2e9d489184477e224fa0fc4bd9f6a))
* **sim:** bench-encode subcommand for the capture encode ceiling ([97f63b3](https://github.com/arcboxlabs/linkcode/commit/97f63b34d4bcac98c1fb5a358394c8671d12704b))
* **sim:** configurable capture scale (default 1.0) to unlock 60fps ([b791d5e](https://github.com/arcboxlabs/linkcode/commit/b791d5e090b9114909e0a38a7e716985f3d27717))
* **sim:** default stream to 60fps and document the encode benchmark ([6c1cc87](https://github.com/arcboxlabs/linkcode/commit/6c1cc879d82e55138979f27ccc50feb2dc2aa630))
* **sim:** device rotation via GraphicsServices GSEvent (CODE-408) ([e40179a](https://github.com/arcboxlabs/linkcode/commit/e40179a311214403ca38e02acfdbafb5ccab242d))
* **sim:** event-driven dead-session reap via an isolated state watcher ([b33886e](https://github.com/arcboxlabs/linkcode/commit/b33886e4ad6decab67a8f40e6d68c781c5fab135))
* **sim:** interface-orientation injection via GraphicsServices GSEvent ([7c70014](https://github.com/arcboxlabs/linkcode/commit/7c700142a31b0de5d26a4b1dd59df412fcb748e8))
* **sim:** linkcode-sim iOS Simulator sidecar — P0 simctl lifecycle (CODE-392) ([87e0f4a](https://github.com/arcboxlabs/linkcode/commit/87e0f4a31725ff86c60595db49f2afd2d2208a72))
* **sim:** P1 private-API framebuffer streaming + HID injection, crash-isolated ([5fc8439](https://github.com/arcboxlabs/linkcode/commit/5fc84396afdc6e0e80295d9835e45782f4ab93ab))
* **sim:** P1 private-API framebuffer streaming + HID injection, crash-isolated (CODE-396) ([363d606](https://github.com/arcboxlabs/linkcode/commit/363d606dbbdcb48077b9aa3238c6b9ba5ad42fd0))
* **sim:** panel rotate button cycling interface orientation ([91486d0](https://github.com/arcboxlabs/linkcode/commit/91486d09fa0136cdcef826d3736d53e4aff7a259))
* **sim:** reach the guest accessibility service through AXPTranslator ([138345b](https://github.com/arcboxlabs/linkcode/commit/138345bad236b21108a3afb81eb45010dc77ec09))
* **sim:** reconfigure a running capture stream in place instead of respawning the worker ([c0442f4](https://github.com/arcboxlabs/linkcode/commit/c0442f40ac6c5c8298584ac7913d9e8a82294726))
* **sim:** stream frames + interactive ops in the @linkcode/sim client ([c79ebaa](https://github.com/arcboxlabs/linkcode/commit/c79ebaaa8b418f74420e45032a0476061be1cdc8))
* **sim:** thread rotate through wire/SDK/engine/client-core + sim_rotate MCP tool (wire 50) ([c6e70aa](https://github.com/arcboxlabs/linkcode/commit/c6e70aa47a010bbc794795dff50ee4a786726582))
* **sim:** walk the guest accessibility tree into tappable nodes ([0fc095e](https://github.com/arcboxlabs/linkcode/commit/0fc095e7573f270c9da2dafca0e73298822676b8))
* **ui,i18n:** simulator screen canvas + optional panel-section vocabulary ([a610778](https://github.com/arcboxlabs/linkcode/commit/a6107782482752804aab849e74536a2c8b485605))
* **ui,workbench:** comfortable/compact list density preference ([6529181](https://github.com/arcboxlabs/linkcode/commit/652918118061bc3df4926cc913513fe734f750c4))
* **ui,workbench:** decode H.264 simulator streams with WebCodecs ([29a27b8](https://github.com/arcboxlabs/linkcode/commit/29a27b86bc2dd93f69dfb00f6f7fa5d3c5c6887f))
* **ui:** 2xs type token, semantic label tiers, tabular numerals ([bf0945a](https://github.com/arcboxlabs/linkcode/commit/bf0945a231104c72852bd569110a0f68e18aa23c))
* **ui:** add link target classifier, icons, and chip ([166b968](https://github.com/arcboxlabs/linkcode/commit/166b9686d250069da0b0b678b0421e4a348cfefc))
* **ui:** composite a realistic device chassis in canvas native space ([f5489c6](https://github.com/arcboxlabs/linkcode/commit/f5489c65f3333fe34310c1e0aebb308cd00e325c))
* **ui:** device-style bezel around the simulator screen ([1ed8033](https://github.com/arcboxlabs/linkcode/commit/1ed803316963eefaaa34518a3ee76baaf8ab193e))
* **ui:** motion duration tokens and the shared spring ([0a98ed4](https://github.com/arcboxlabs/linkcode/commit/0a98ed49ad40f8963d95c6b75cc2c75534654ad5))
* **ui:** press feedback on custom tabs, close buttons, and chat rows ([4fd9a4d](https://github.com/arcboxlabs/linkcode/commit/4fd9a4db37b64940deecfe0ab8a992bbb8498f68))
* **ui:** render favicons and link chips in chat markdown ([9234b45](https://github.com/arcboxlabs/linkcode/commit/9234b4503b9e4d6d1e37a6bc3bd598b92ff9be5a))
* **ui:** squircle corner-shape on xl+ radius faces ([40e0bd8](https://github.com/arcboxlabs/linkcode/commit/40e0bd8e150add50f495518b70e4efc798e5a443))
* **workbench,schema:** open up to four simulators per thread as device tabs ([5c5bfbc](https://github.com/arcboxlabs/linkcode/commit/5c5bfbcd349d9653bf1a86f62608710358722c58))
* **workbench,ui:** clip the simulator screen with the real device mask ([cbcc70e](https://github.com/arcboxlabs/linkcode/commit/cbcc70eaed823c5b69b5f1b47bb7fc55e558d7f5))
* **workbench,ui:** matched-geometry view transition on session switch ([#299](https://github.com/arcboxlabs/linkcode/issues/299)) ([f763ea6](https://github.com/arcboxlabs/linkcode/commit/f763ea65300ccf74ab4e47bc17299c421774be4c))
* **workbench:** add simulator boot state, detach, and shutdown controls ([1b7d7fe](https://github.com/arcboxlabs/linkcode/commit/1b7d7fe3dd36b4f4467caa3b0f8f6a830d653fb1))
* **workbench:** add simulator screenshot and screen recording controls ([a775f46](https://github.com/arcboxlabs/linkcode/commit/a775f46a2601db0ef1731e51d091858e6ab95021))
* **workbench:** add simulator stream tuning row (frame rate, resolution, encoding, FPS) ([dc594b5](https://github.com/arcboxlabs/linkcode/commit/dc594b56504a631af3d092b667f04bae36eb5705))
* **workbench:** restage simulator panel to match reference layout ([#267](https://github.com/arcboxlabs/linkcode/issues/267)) ([b4d664b](https://github.com/arcboxlabs/linkcode/commit/b4d664bf4fea6a6baa7f9bab93acaf36f50421b9))
* **workbench:** restage simulator panel with text device picker and toolbar island ([58d17fa](https://github.com/arcboxlabs/linkcode/commit/58d17fa58c83f6e2621fd75536ab51b9d6c6e471))
* **workbench:** retune the simulator stream in place via streamStart reconfigure ([e022efa](https://github.com/arcboxlabs/linkcode/commit/e022efaeae4454b05e31f5891b36c91b22cb2872))
* **workbench:** show an agent-driving badge over the simulator stage ([89fb0cf](https://github.com/arcboxlabs/linkcode/commit/89fb0cf30cdaca6ccc2aaf17b8479fc094093a45))
* **workbench:** simulator consent prompt, per-device toggle, and agent kill switch ([ac22acc](https://github.com/arcboxlabs/linkcode/commit/ac22acc76a01d7cf25329182796c318f4d4ce61e))
* **workbench:** simulator stream registry + panel container ([45b5aa5](https://github.com/arcboxlabs/linkcode/commit/45b5aa5d7d11d79f63bd774cfe65b37bc15a3a26))


### Bug Fixes

* **agent-adapter:** load project shell environment ([83903d0](https://github.com/arcboxlabs/linkcode/commit/83903d0786de6eb94c7251f2a36cd13bff9da660))
* **agent-adapter:** preserve resolved codex environment ([6a1a9ef](https://github.com/arcboxlabs/linkcode/commit/6a1a9ef30806d5ffd4a72bac5af6c9c17493bef9))
* **agent:** align effort schema with provider-specific capabilities ([#234](https://github.com/arcboxlabs/linkcode/issues/234)) ([a2cf3de](https://github.com/arcboxlabs/linkcode/commit/a2cf3de462ee32f394c0916e9cff58254c49d80a))
* **assets:** regenerate the pi closure after the ws bump ([f7892d1](https://github.com/arcboxlabs/linkcode/commit/f7892d182e628513a596eccecb3691fdd2d31dd4))
* **client-core,mobile:** announce on the route session id and drop announcements on a dead connection ([b77d79d](https://github.com/arcboxlabs/linkcode/commit/b77d79da1522098294e520a1a4cc5ae0bf900246))
* **client-core,mobile:** cap the retry budget so a permanent failure stops dialing ([72564c3](https://github.com/arcboxlabs/linkcode/commit/72564c3edfbad21d78f3cb22f667bf057d84ba4d))
* **daemon:** give each channel a disjoint port range ([b4631fb](https://github.com/arcboxlabs/linkcode/commit/b4631fbcc6c68880e0ccef965bfcbafe85ab53dd))
* **desktop,workbench:** share the e2e wire pin and bind the capture chords ([a86b941](https://github.com/arcboxlabs/linkcode/commit/a86b941ce21a8de227d3d951f66559cc1255b69d))
* **desktop:** don't persist ephemeral preview-proxy URLs (CODE-373) ([#241](https://github.com/arcboxlabs/linkcode/issues/241)) ([ae0117e](https://github.com/arcboxlabs/linkcode/commit/ae0117edc6702b398ad04caeb779654f067417a7))
* **desktop:** gate the Browser pane's media pause on dom-ready ([c8b5a5d](https://github.com/arcboxlabs/linkcode/commit/c8b5a5d50029dcb7306597b6b275fb7abc6d3ab3))
* **e2e:** deterministic maximize checks in the window-bounds suite ([#283](https://github.com/arcboxlabs/linkcode/issues/283)) ([3725a94](https://github.com/arcboxlabs/linkcode/commit/3725a945cada7db01c9a3b0733a3003297bbe149))
* **release:** preserve release merge validation ([4f4c168](https://github.com/arcboxlabs/linkcode/commit/4f4c168077bc78964de0b325fcbf71ce4eba4500))
* **release:** trust only protected automation ([14c3431](https://github.com/arcboxlabs/linkcode/commit/14c3431d189f48eee967d9bbe1113259027c708f))
* **sim,engine,ui,schema:** resolve iOS Simulator panel review findings (wire 51) ([b575f2c](https://github.com/arcboxlabs/linkcode/commit/b575f2cf89e9e306ca095d8a3684c25c39fc7d7f))
* **sim:** close the worker pid-publication race so a drop during spawn still kills the child ([1c9eee7](https://github.com/arcboxlabs/linkcode/commit/1c9eee7c9fba288e9df399b4d556ec5799c8f14b))
* **sim:** guard stale sidecar-child events, fail writes fast, fix boot/reclaim ownership races ([1d23526](https://github.com/arcboxlabs/linkcode/commit/1d235267bd02cb917378b6876da0cb5b9f6d03cb))
* **sim:** harden P0 sidecar — scrub Apple SDK env, guard oversized frames, bound + drain workers ([c639e5c](https://github.com/arcboxlabs/linkcode/commit/c639e5c7570e565de81d65ddb78824c8a6844e62))
* **sim:** honor scale for H.264 by sizing the compression session ([1969e49](https://github.com/arcboxlabs/linkcode/commit/1969e498fa9b8f8f14a9124783e3c27a9d4069ef))
* **sim:** honor the HID send verdict instead of assuming every injection landed ([78401de](https://github.com/arcboxlabs/linkcode/commit/78401de258946f996e6f172ee16ef49b4b3e7d07))
* **sim:** keep the send acknowledgement's block alive and stop retrying unanswered sends ([1d4467a](https://github.com/arcboxlabs/linkcode/commit/1d4467a24317e3eb85dad0d4629933f7e843f1a9))
* **sim:** kill a stuck capture worker on stop, fix ABA frame dedup + silent-worker fallback ([f82366b](https://github.com/arcboxlabs/linkcode/commit/f82366b2f4b6d916a6c946566309f8a322e698ff))
* **sim:** re-plant the wheel-scroll finger at screen edges so long scrolls don't stall ([769d9ac](https://github.com/arcboxlabs/linkcode/commit/769d9acaef1b0cf1c73e6177723d959dd10478b3))
* **sim:** re-warm the HID client for streamed touch and pinch too ([ce39cfc](https://github.com/arcboxlabs/linkcode/commit/ce39cfc62890bfb0bb60acd3ca135f1805d2a9f9))
* **sim:** re-warm the HID client when a device reboots out from under it ([d66b742](https://github.com/arcboxlabs/linkcode/commit/d66b742c8c7b61bf7f6d4c55d12cab167085945d))
* **sim:** reap a stream and its HID client when the device leaves Booted ([7ecdbe3](https://github.com/arcboxlabs/linkcode/commit/7ecdbe3304616ee47c839180e7097f3a2e04c141))
* **sim:** reconcile boot ownership on failure, guard resume during reclaim, declare foxts dep ([abc79e1](https://github.com/arcboxlabs/linkcode/commit/abc79e12a5776cf4dd022aa76d94a9c932b5f3a9))
* **sim:** reject unknown sessions and roll back claims from failed commands ([d5c2466](https://github.com/arcboxlabs/linkcode/commit/d5c246633df4f96582690e190c460025d55135ef))
* **sim:** release MCP token on failed start, don't shadow user servers, cap MCP body (wire 45) ([90abf33](https://github.com/arcboxlabs/linkcode/commit/90abf338056a0c186358a865650625ed90bfb80f))
* **sim:** resolve device-rotation review findings ([f4133a0](https://github.com/arcboxlabs/linkcode/commit/f4133a03f00ff7d9413376ba94a729884d2eed11))
* **sim:** stable headless framebuffer capture on Xcode 26 ([dae9a83](https://github.com/arcboxlabs/linkcode/commit/dae9a8303d7d1b985117e37d75d0c78068bb5a6d))
* **ui,agent-adapter:** show nearby rows and line numbers in the inline diff card (CODE-399) ([#304](https://github.com/arcboxlabs/linkcode/issues/304)) ([b5e0150](https://github.com/arcboxlabs/linkcode/commit/b5e015035bec2d26979d3ab5242e1bfd1a2cdf4d))
* **ui:** drive thread-row height from the density var, not padding ([b9c6be8](https://github.com/arcboxlabs/linkcode/commit/b9c6be8b4d328f39075b223f1d6e444d3980b356))
* **ui:** grow the chassis from the real mask for even band and matching curvature ([3b76326](https://github.com/arcboxlabs/linkcode/commit/3b76326aca585a842524fcf287987525ace29131))
* **ui:** improve inline file detector detectInlineFilePath ([79e46c2](https://github.com/arcboxlabs/linkcode/commit/79e46c226ac97b203d14aeac00b1177305cf37e8))
* **ui:** preserve absolute file links ([61baa4e](https://github.com/arcboxlabs/linkcode/commit/61baa4e8ee6af86a195e97caa7584d7c1c758abc))
* **ui:** restore dual-source favicons ([723a80f](https://github.com/arcboxlabs/linkcode/commit/723a80fe1663d107cd7d71ec7566c2ab0eac24cb))
* **ui:** secure chat link handling ([eca8f74](https://github.com/arcboxlabs/linkcode/commit/eca8f74997597d83af17b898cc5da505ee77252e))
* **ui:** soften continuous corners to superellipse(1.1) ([#319](https://github.com/arcboxlabs/linkcode/issues/319)) ([c8ea47c](https://github.com/arcboxlabs/linkcode/commit/c8ea47c9b7fec0e12ed858a706dd10c475c50b2e))
* **ui:** squircle the logical-corner cells of card-variant tables ([8baf4c0](https://github.com/arcboxlabs/linkcode/commit/8baf4c07fc1995e9a9bee31630bc0ef123e698fe))
* **workbench,ui:** scope the new-session agent catalog to the selected workspace ([c5db789](https://github.com/arcboxlabs/linkcode/commit/c5db7890b89a6251f33e2b20254e1b7e920a2bef))
* **workbench:** drop stale catalogs and reset the workspace pick on leave ([07138cb](https://github.com/arcboxlabs/linkcode/commit/07138cb48fe785307f1d8ad2bd7ec935ab6159f9))


### Performance Improvements

* **sim:** 30fps stream + fire-and-forget touch/pinch move to kill per-move round-trip stutter ([09152d4](https://github.com/arcboxlabs/linkcode/commit/09152d46c4b4fa7b051548561a814d74b7eb429c))
* **sim:** layer static chassis + per-frame screen so 60 fps stays smooth ([b4ec389](https://github.com/arcboxlabs/linkcode/commit/b4ec389df99295791fc23784c5ebabe6b8966ed1))
* **sim:** precise frame pacing via mach_wait_until ([062a950](https://github.com/arcboxlabs/linkcode/commit/062a950883665634cd4210b1fee492d3759e6018))

## [0.9.0](https://github.com/arcboxlabs/linkcode/compare/v0.8.0...v0.9.0) (2026-07-29)


### Features

* **agent-adapter:** advertise approval tiers before session start ([#305](https://github.com/arcboxlabs/linkcode/issues/305)) ([d9b74b0](https://github.com/arcboxlabs/linkcode/commit/d9b74b0c917688a902cc1301df345a3a315dffbd))
* **desktop,ipc,ui:** chrome title overflow menu — thread actions, reveal, open in editor ([#265](https://github.com/arcboxlabs/linkcode/issues/265)) ([a551149](https://github.com/arcboxlabs/linkcode/commit/a55114902d8a1a713f951d34eeaab5003012f021))
* **mobile:** redesign the app on @expo/ui ([#306](https://github.com/arcboxlabs/linkcode/issues/306)) ([04d3207](https://github.com/arcboxlabs/linkcode/commit/04d32077db4abd92921969f76ee3d22b356c4e7d))
* **plugins:** discover and aggregate provider plugins ([#272](https://github.com/arcboxlabs/linkcode/issues/272)) ([c9f5f68](https://github.com/arcboxlabs/linkcode/commit/c9f5f68b59a512714006a49f9168485f82b2227d))
* **schema,daemon,desktop:** fork on-disk state by channel ([d373756](https://github.com/arcboxlabs/linkcode/commit/d3737564ae40ad5762f71a9ed31318900c0ab5ab))
* **schema,engine,desktop:** browser broker — wire contract, webview executor, code-mode execute tool for claude/pi (CODE-267) ([#188](https://github.com/arcboxlabs/linkcode/issues/188)) ([3f70dad](https://github.com/arcboxlabs/linkcode/commit/3f70dadfe8b8514b20c25338fa5f078b6facfcb1))
* **workbench,ui:** matched-geometry view transition on session switch ([#299](https://github.com/arcboxlabs/linkcode/issues/299)) ([f763ea6](https://github.com/arcboxlabs/linkcode/commit/f763ea65300ccf74ab4e47bc17299c421774be4c))


### Bug Fixes

* **assets:** regenerate the pi closure after the ws bump ([f7892d1](https://github.com/arcboxlabs/linkcode/commit/f7892d182e628513a596eccecb3691fdd2d31dd4))
* **daemon:** give each channel a disjoint port range ([b4631fb](https://github.com/arcboxlabs/linkcode/commit/b4631fbcc6c68880e0ccef965bfcbafe85ab53dd))
* **ui:** soften continuous corners to superellipse(1.1) ([#319](https://github.com/arcboxlabs/linkcode/issues/319)) ([c8ea47c](https://github.com/arcboxlabs/linkcode/commit/c8ea47c9b7fec0e12ed858a706dd10c475c50b2e))

## [0.8.0](https://github.com/arcboxlabs/linkcode/compare/v0.7.0...v0.8.0) (2026-07-29)


### Features

* **agent-adapter:** complete opencode and Pi slash commands ([#242](https://github.com/arcboxlabs/linkcode/issues/242)) ([176360d](https://github.com/arcboxlabs/linkcode/commit/176360dcdef610cc5bbf9476ab72ec59bfbc75a9))
* **agent-adapter:** probe and spawn opencode from the resolved binary (CODE-76) ([#244](https://github.com/arcboxlabs/linkcode/issues/244)) ([fda7e09](https://github.com/arcboxlabs/linkcode/commit/fda7e09072fe28be7c9c4f1777797aa64a19a59b))
* **daemon:** agent input tools — tap, swipe, text, and named keys ([2f681a0](https://github.com/arcboxlabs/linkcode/commit/2f681a08dd8e6951bc18a39cc91e8fb8a5761170))
* **desktop,ui:** multi-tab Browser panel — tabbed webviews, popup capture, find/zoom/devtools (CODE-266) ([#181](https://github.com/arcboxlabs/linkcode/issues/181)) ([a7c21be](https://github.com/arcboxlabs/linkcode/commit/a7c21be2c3d0e444c91715f9e44b0949b373f2a7))
* **schema,daemon,ui:** show where an agent is touching the device ([ebe8ead](https://github.com/arcboxlabs/linkcode/commit/ebe8eadda49a9e3399cd59458b8c26f9b64410ca))
* **schema,engine,daemon:** describe_ui — the guest UI tree as an agent tool ([6bf4297](https://github.com/arcboxlabs/linkcode/commit/6bf429709aa935a4b31cf5c434937244e4dcdc15))
* **sim,engine,daemon:** shake a device without reversing the motion payload ([699c4e4](https://github.com/arcboxlabs/linkcode/commit/699c4e41e3fe07b94c6c2c8085f1e4ec91e994b9))
* **sim,engine,workbench:** guide setup instead of reporting simulators unavailable ([e7a6791](https://github.com/arcboxlabs/linkcode/commit/e7a679129f95263621d0e90503fd9449d48fdccc))
* **sim:** event-driven dead-session reap via an isolated state watcher ([b33886e](https://github.com/arcboxlabs/linkcode/commit/b33886e4ad6decab67a8f40e6d68c781c5fab135))
* **sim:** reach the guest accessibility service through AXPTranslator ([138345b](https://github.com/arcboxlabs/linkcode/commit/138345bad236b21108a3afb81eb45010dc77ec09))
* **sim:** walk the guest accessibility tree into tappable nodes ([0fc095e](https://github.com/arcboxlabs/linkcode/commit/0fc095e7573f270c9da2dafca0e73298822676b8))
* **ui,workbench:** comfortable/compact list density preference ([6529181](https://github.com/arcboxlabs/linkcode/commit/652918118061bc3df4926cc913513fe734f750c4))
* **ui:** 2xs type token, semantic label tiers, tabular numerals ([bf0945a](https://github.com/arcboxlabs/linkcode/commit/bf0945a231104c72852bd569110a0f68e18aa23c))
* **ui:** motion duration tokens and the shared spring ([0a98ed4](https://github.com/arcboxlabs/linkcode/commit/0a98ed49ad40f8963d95c6b75cc2c75534654ad5))
* **ui:** press feedback on custom tabs, close buttons, and chat rows ([4fd9a4d](https://github.com/arcboxlabs/linkcode/commit/4fd9a4db37b64940deecfe0ab8a992bbb8498f68))
* **ui:** squircle corner-shape on xl+ radius faces ([40e0bd8](https://github.com/arcboxlabs/linkcode/commit/40e0bd8e150add50f495518b70e4efc798e5a443))


### Bug Fixes

* **agent:** align effort schema with provider-specific capabilities ([#234](https://github.com/arcboxlabs/linkcode/issues/234)) ([a2cf3de](https://github.com/arcboxlabs/linkcode/commit/a2cf3de462ee32f394c0916e9cff58254c49d80a))
* **desktop,workbench:** share the e2e wire pin and bind the capture chords ([a86b941](https://github.com/arcboxlabs/linkcode/commit/a86b941ce21a8de227d3d951f66559cc1255b69d))
* **desktop:** don't persist ephemeral preview-proxy URLs (CODE-373) ([#241](https://github.com/arcboxlabs/linkcode/issues/241)) ([ae0117e](https://github.com/arcboxlabs/linkcode/commit/ae0117edc6702b398ad04caeb779654f067417a7))
* **e2e:** deterministic maximize checks in the window-bounds suite ([#283](https://github.com/arcboxlabs/linkcode/issues/283)) ([3725a94](https://github.com/arcboxlabs/linkcode/commit/3725a945cada7db01c9a3b0733a3003297bbe149))
* **sim:** honor the HID send verdict instead of assuming every injection landed ([78401de](https://github.com/arcboxlabs/linkcode/commit/78401de258946f996e6f172ee16ef49b4b3e7d07))
* **sim:** keep the send acknowledgement's block alive and stop retrying unanswered sends ([1d4467a](https://github.com/arcboxlabs/linkcode/commit/1d4467a24317e3eb85dad0d4629933f7e843f1a9))
* **sim:** re-warm the HID client for streamed touch and pinch too ([ce39cfc](https://github.com/arcboxlabs/linkcode/commit/ce39cfc62890bfb0bb60acd3ca135f1805d2a9f9))
* **sim:** re-warm the HID client when a device reboots out from under it ([d66b742](https://github.com/arcboxlabs/linkcode/commit/d66b742c8c7b61bf7f6d4c55d12cab167085945d))
* **sim:** reap a stream and its HID client when the device leaves Booted ([7ecdbe3](https://github.com/arcboxlabs/linkcode/commit/7ecdbe3304616ee47c839180e7097f3a2e04c141))
* **ui,agent-adapter:** show nearby rows and line numbers in the inline diff card (CODE-399) ([#304](https://github.com/arcboxlabs/linkcode/issues/304)) ([b5e0150](https://github.com/arcboxlabs/linkcode/commit/b5e015035bec2d26979d3ab5242e1bfd1a2cdf4d))
* **ui:** drive thread-row height from the density var, not padding ([b9c6be8](https://github.com/arcboxlabs/linkcode/commit/b9c6be8b4d328f39075b223f1d6e444d3980b356))
* **ui:** squircle the logical-corner cells of card-variant tables ([8baf4c0](https://github.com/arcboxlabs/linkcode/commit/8baf4c07fc1995e9a9bee31630bc0ef123e698fe))

## [0.7.0](https://github.com/arcboxlabs/linkcode/compare/v0.6.3...v0.7.0) (2026-07-25)


### Features

* **agent-adapter,engine,daemon:** simulator MCP tools for every MCP-capable agent ([9bf470d](https://github.com/arcboxlabs/linkcode/commit/9bf470d0bb80353d438ca376517fe0cb176f2823))
* **agent-adapter,engine,daemon:** simulator MCP tools for every MCP-capable agent (CODE-395) ([5311e50](https://github.com/arcboxlabs/linkcode/commit/5311e50888864bd14ce0ec40993a81d500007abe))
* **client-core:** simulator control surface ([e446d1b](https://github.com/arcboxlabs/linkcode/commit/e446d1bdf1bd88d1c65e0d4eb3ab3acfcca4c690))
* **composer:** serialize file mentions as markdown links ([6797c14](https://github.com/arcboxlabs/linkcode/commit/6797c1468e3caa7dc97118a83aae908796132c7b))
* **daemon,desktop:** wire the sim sidecar client into the engine ([0e2e9d1](https://github.com/arcboxlabs/linkcode/commit/0e2e9d10eb8d96a2a913ee1d4b03fe1baa137cc4))
* **desktop,ui:** simulator as an on-demand right-panel section ([c477228](https://github.com/arcboxlabs/linkcode/commit/c4772289b13b06e172efd897b07fab3d062a6f5c))
* **desktop,workbench,ui:** iOS Simulator panel — on-demand section with live co-driving stream (CODE-397) ([34d0b1b](https://github.com/arcboxlabs/linkcode/commit/34d0b1b6c9a6374ade6b9ecfe9d037c8c508fc37))
* **desktop:** allow google favicon hosts in renderer csp ([771adf9](https://github.com/arcboxlabs/linkcode/commit/771adf9cf784bc44232c18a41eed4a50936759af))
* **engine:** simulator tap/swipe/button + framebuffer stream in the backend port and service ([9257071](https://github.com/arcboxlabs/linkcode/commit/92570716f00c3a43df762c5e35089fc462588d59))
* **engine:** simulator wire request handler ([d2407e1](https://github.com/arcboxlabs/linkcode/commit/d2407e16a5400f2a0ce209620dc881b5e73aca07))
* **engine:** SimulatorBackend port and per-session device registry ([8828cd3](https://github.com/arcboxlabs/linkcode/commit/8828cd3211248925790b523a18a781780b2dcada))
* **schema,engine,client-core:** H.264 stream codec plumbing (wire 47) ([4a7e54e](https://github.com/arcboxlabs/linkcode/commit/4a7e54ee50d87162f36518726cee77203171aee2))
* **schema,engine,client-core:** simulator screen-mask wire (wire 46) ([e4e1faf](https://github.com/arcboxlabs/linkcode/commit/e4e1faf683a9b8df1856291564a27f5f55a2f4a4))
* **schema,engine,client-core:** simulator wire contract — availability, device commands, screenshot (CODE-394) ([ebfa242](https://github.com/arcboxlabs/linkcode/commit/ebfa242418b9e4ffc056a61248e0e22e4f8f87ee))
* **schema,transport,engine,client-core:** simulator interactive + stream wire (wire 45) ([4f9ddf2](https://github.com/arcboxlabs/linkcode/commit/4f9ddf2e67e57ec91289dce637d592b60f4c56e6))
* **schema:** add normalized plugin model ([#263](https://github.com/arcboxlabs/linkcode/issues/263)) ([558e6ba](https://github.com/arcboxlabs/linkcode/commit/558e6baf57c0207d464a2e07accfe03a0faaf8da))
* **sim-sidecar:** hardware H.264 streaming via VideoToolbox (zero-copy IOSurface) ([c0aee6d](https://github.com/arcboxlabs/linkcode/commit/c0aee6dfc4e794fd047bbc65d9737a3389f29fdb))
* **sim-sidecar:** screenMask op rendering the devicetype framebuffer mask ([9af3b83](https://github.com/arcboxlabs/linkcode/commit/9af3b834797250075ac41e47ece6f9b96beab742))
* **sim,engine:** @linkcode/sim SDK + SimulatorBackend with per-session device ownership (CODE-393) ([b857f9d](https://github.com/arcboxlabs/linkcode/commit/b857f9d1da78a75746d51287fd0c3c8fe4dbc6a1))
* **sim,schema,engine,client,ui:** streamed touch, wheel scroll, HID keyboard (wire 48) ([09410ba](https://github.com/arcboxlabs/linkcode/commit/09410ba00b1b970d64362874b1a736a32e202a34))
* **sim,schema,engine,client,ui:** two-finger pinch + IME pasteboard input (wire 49) ([e4c6bb4](https://github.com/arcboxlabs/linkcode/commit/e4c6bb4cece6bd0a0c87a810bb0965d0e71f0ead))
* **sim:** @linkcode/sim typed sidecar client ([87d842d](https://github.com/arcboxlabs/linkcode/commit/87d842d54fb2e9d489184477e224fa0fc4bd9f6a))
* **sim:** bench-encode subcommand for the capture encode ceiling ([97f63b3](https://github.com/arcboxlabs/linkcode/commit/97f63b34d4bcac98c1fb5a358394c8671d12704b))
* **sim:** configurable capture scale (default 1.0) to unlock 60fps ([b791d5e](https://github.com/arcboxlabs/linkcode/commit/b791d5e090b9114909e0a38a7e716985f3d27717))
* **sim:** default stream to 60fps and document the encode benchmark ([6c1cc87](https://github.com/arcboxlabs/linkcode/commit/6c1cc879d82e55138979f27ccc50feb2dc2aa630))
* **sim:** device rotation via GraphicsServices GSEvent (CODE-408) ([e40179a](https://github.com/arcboxlabs/linkcode/commit/e40179a311214403ca38e02acfdbafb5ccab242d))
* **sim:** interface-orientation injection via GraphicsServices GSEvent ([7c70014](https://github.com/arcboxlabs/linkcode/commit/7c700142a31b0de5d26a4b1dd59df412fcb748e8))
* **sim:** linkcode-sim iOS Simulator sidecar — P0 simctl lifecycle (CODE-392) ([87e0f4a](https://github.com/arcboxlabs/linkcode/commit/87e0f4a31725ff86c60595db49f2afd2d2208a72))
* **sim:** P1 private-API framebuffer streaming + HID injection, crash-isolated ([5fc8439](https://github.com/arcboxlabs/linkcode/commit/5fc84396afdc6e0e80295d9835e45782f4ab93ab))
* **sim:** P1 private-API framebuffer streaming + HID injection, crash-isolated (CODE-396) ([363d606](https://github.com/arcboxlabs/linkcode/commit/363d606dbbdcb48077b9aa3238c6b9ba5ad42fd0))
* **sim:** panel rotate button cycling interface orientation ([91486d0](https://github.com/arcboxlabs/linkcode/commit/91486d09fa0136cdcef826d3736d53e4aff7a259))
* **sim:** stream frames + interactive ops in the @linkcode/sim client ([c79ebaa](https://github.com/arcboxlabs/linkcode/commit/c79ebaaa8b418f74420e45032a0476061be1cdc8))
* **sim:** thread rotate through wire/SDK/engine/client-core + sim_rotate MCP tool (wire 50) ([c6e70aa](https://github.com/arcboxlabs/linkcode/commit/c6e70aa47a010bbc794795dff50ee4a786726582))
* **ui,i18n:** simulator screen canvas + optional panel-section vocabulary ([a610778](https://github.com/arcboxlabs/linkcode/commit/a6107782482752804aab849e74536a2c8b485605))
* **ui,workbench:** decode H.264 simulator streams with WebCodecs ([29a27b8](https://github.com/arcboxlabs/linkcode/commit/29a27b86bc2dd93f69dfb00f6f7fa5d3c5c6887f))
* **ui:** add link target classifier, icons, and chip ([166b968](https://github.com/arcboxlabs/linkcode/commit/166b9686d250069da0b0b678b0421e4a348cfefc))
* **ui:** composite a realistic device chassis in canvas native space ([f5489c6](https://github.com/arcboxlabs/linkcode/commit/f5489c65f3333fe34310c1e0aebb308cd00e325c))
* **ui:** device-style bezel around the simulator screen ([1ed8033](https://github.com/arcboxlabs/linkcode/commit/1ed803316963eefaaa34518a3ee76baaf8ab193e))
* **ui:** render favicons and link chips in chat markdown ([9234b45](https://github.com/arcboxlabs/linkcode/commit/9234b4503b9e4d6d1e37a6bc3bd598b92ff9be5a))
* **workbench,ui:** clip the simulator screen with the real device mask ([cbcc70e](https://github.com/arcboxlabs/linkcode/commit/cbcc70eaed823c5b69b5f1b47bb7fc55e558d7f5))
* **workbench:** restage simulator panel to match reference layout ([#267](https://github.com/arcboxlabs/linkcode/issues/267)) ([b4d664b](https://github.com/arcboxlabs/linkcode/commit/b4d664bf4fea6a6baa7f9bab93acaf36f50421b9))
* **workbench:** restage simulator panel with text device picker and toolbar island ([58d17fa](https://github.com/arcboxlabs/linkcode/commit/58d17fa58c83f6e2621fd75536ab51b9d6c6e471))
* **workbench:** simulator stream registry + panel container ([45b5aa5](https://github.com/arcboxlabs/linkcode/commit/45b5aa5d7d11d79f63bd774cfe65b37bc15a3a26))


### Bug Fixes

* **desktop:** gate the Browser pane's media pause on dom-ready ([c8b5a5d](https://github.com/arcboxlabs/linkcode/commit/c8b5a5d50029dcb7306597b6b275fb7abc6d3ab3))
* **release:** preserve release merge validation ([4f4c168](https://github.com/arcboxlabs/linkcode/commit/4f4c168077bc78964de0b325fcbf71ce4eba4500))
* **release:** trust only protected automation ([14c3431](https://github.com/arcboxlabs/linkcode/commit/14c3431d189f48eee967d9bbe1113259027c708f))
* **sim,engine,ui,schema:** resolve iOS Simulator panel review findings (wire 51) ([b575f2c](https://github.com/arcboxlabs/linkcode/commit/b575f2cf89e9e306ca095d8a3684c25c39fc7d7f))
* **sim:** close the worker pid-publication race so a drop during spawn still kills the child ([1c9eee7](https://github.com/arcboxlabs/linkcode/commit/1c9eee7c9fba288e9df399b4d556ec5799c8f14b))
* **sim:** guard stale sidecar-child events, fail writes fast, fix boot/reclaim ownership races ([1d23526](https://github.com/arcboxlabs/linkcode/commit/1d235267bd02cb917378b6876da0cb5b9f6d03cb))
* **sim:** harden P0 sidecar — scrub Apple SDK env, guard oversized frames, bound + drain workers ([c639e5c](https://github.com/arcboxlabs/linkcode/commit/c639e5c7570e565de81d65ddb78824c8a6844e62))
* **sim:** kill a stuck capture worker on stop, fix ABA frame dedup + silent-worker fallback ([f82366b](https://github.com/arcboxlabs/linkcode/commit/f82366b2f4b6d916a6c946566309f8a322e698ff))
* **sim:** re-plant the wheel-scroll finger at screen edges so long scrolls don't stall ([769d9ac](https://github.com/arcboxlabs/linkcode/commit/769d9acaef1b0cf1c73e6177723d959dd10478b3))
* **sim:** reconcile boot ownership on failure, guard resume during reclaim, declare foxts dep ([abc79e1](https://github.com/arcboxlabs/linkcode/commit/abc79e12a5776cf4dd022aa76d94a9c932b5f3a9))
* **sim:** reject unknown sessions and roll back claims from failed commands ([d5c2466](https://github.com/arcboxlabs/linkcode/commit/d5c246633df4f96582690e190c460025d55135ef))
* **sim:** release MCP token on failed start, don't shadow user servers, cap MCP body (wire 45) ([90abf33](https://github.com/arcboxlabs/linkcode/commit/90abf338056a0c186358a865650625ed90bfb80f))
* **sim:** resolve device-rotation review findings ([f4133a0](https://github.com/arcboxlabs/linkcode/commit/f4133a03f00ff7d9413376ba94a729884d2eed11))
* **sim:** stable headless framebuffer capture on Xcode 26 ([dae9a83](https://github.com/arcboxlabs/linkcode/commit/dae9a8303d7d1b985117e37d75d0c78068bb5a6d))
* **ui:** grow the chassis from the real mask for even band and matching curvature ([3b76326](https://github.com/arcboxlabs/linkcode/commit/3b76326aca585a842524fcf287987525ace29131))
* **ui:** improve inline file detector detectInlineFilePath ([79e46c2](https://github.com/arcboxlabs/linkcode/commit/79e46c226ac97b203d14aeac00b1177305cf37e8))
* **ui:** preserve absolute file links ([61baa4e](https://github.com/arcboxlabs/linkcode/commit/61baa4e8ee6af86a195e97caa7584d7c1c758abc))
* **ui:** restore dual-source favicons ([723a80f](https://github.com/arcboxlabs/linkcode/commit/723a80fe1663d107cd7d71ec7566c2ab0eac24cb))
* **ui:** secure chat link handling ([eca8f74](https://github.com/arcboxlabs/linkcode/commit/eca8f74997597d83af17b898cc5da505ee77252e))


### Performance Improvements

* **sim:** 30fps stream + fire-and-forget touch/pinch move to kill per-move round-trip stutter ([09152d4](https://github.com/arcboxlabs/linkcode/commit/09152d46c4b4fa7b051548561a814d74b7eb429c))
* **sim:** layer static chassis + per-frame screen so 60 fps stays smooth ([b4ec389](https://github.com/arcboxlabs/linkcode/commit/b4ec389df99295791fc23784c5ebabe6b8966ed1))
* **sim:** precise frame pacing via mach_wait_until ([062a950](https://github.com/arcboxlabs/linkcode/commit/062a950883665634cd4210b1fee492d3759e6018))
