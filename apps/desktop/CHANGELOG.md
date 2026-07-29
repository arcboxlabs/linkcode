# Changelog

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
