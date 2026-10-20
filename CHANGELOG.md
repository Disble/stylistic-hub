# Stylistic Hub changelog

## [1.1.1-beta.1](https://github.com/Disble/stylistic-hub/compare/hub-v1.1.0...hub-v1.1.1-beta.1) (2026-10-20)

### Bug Fixes

* **word:** restore automatic loader after module readiness ([094ee92](https://github.com/Disble/stylistic-hub/commit/094ee92b65c8e96672a6e65cff57857579cc9da1))

## [1.1.0](https://github.com/Disble/stylistic-hub/compare/hub-v1.0.0...hub-v1.1.0) (2026-10-18)

### Features

* **word:** install the catalog add-in from Home and Word ([cffe66b](https://github.com/Disble/stylistic-hub/commit/cffe66bd2c634d2b129ac7006872af0eaef3500c))
* **word:** load only catalog add-ins in packaged hubs ([0a0cd1c](https://github.com/Disble/stylistic-hub/commit/0a0cd1c9e938db245712e3ddf8c3daea391d5218))

### Bug Fixes

* **health:** trust the managed leaf for server health checks ([fb2be58](https://github.com/Disble/stylistic-hub/commit/fb2be5845fc4d116e6069ba5fcdcf7b67aae6878))
* **scripts:** stage the Word directory without a CLI path ([2ec7b7a](https://github.com/Disble/stylistic-hub/commit/2ec7b7abcfcad9b35e20a3fb403153980b1cd8d8))

## [1.1.0-beta.1](https://github.com/Disble/stylistic-hub/compare/hub-v1.0.0...hub-v1.1.0-beta.1) (2026-10-18)

### Features

* **word:** install the catalog add-in from Home and Word ([cffe66b](https://github.com/Disble/stylistic-hub/commit/cffe66bd2c634d2b129ac7006872af0eaef3500c))
* **word:** load only catalog add-ins in packaged hubs ([0a0cd1c](https://github.com/Disble/stylistic-hub/commit/0a0cd1c9e938db245712e3ddf8c3daea391d5218))

### Bug Fixes

* **health:** trust the managed leaf for server health checks ([fb2be58](https://github.com/Disble/stylistic-hub/commit/fb2be5845fc4d116e6069ba5fcdcf7b67aae6878))
* **scripts:** stage the Word directory without a CLI path ([2ec7b7a](https://github.com/Disble/stylistic-hub/commit/2ec7b7abcfcad9b35e20a3fb403153980b1cd8d8))

## [1.0.0](https://github.com/Disble/stylistic-hub/compare/hub-v0.0.1...hub-v1.0.0) (2026-10-18)

### ⚠ BREAKING CHANGES

* **api:** between the v1 documents before and after.

### Features

* **catalog:** sign the catalog daily and maintain the key list ([eb6c280](https://github.com/Disble/stylistic-hub/commit/eb6c2804a2e8870c33dec97e77d0b9f4d94eebc3))
* **keys:** add the one-time signing key ceremony ([cb776e2](https://github.com/Disble/stylistic-hub/commit/cb776e2c8e62ff58421201195ee3a5e496c771c8))
* **keys:** publish the signed key list from the first ceremony ([85ec811](https://github.com/Disble/stylistic-hub/commit/85ec81183c61c8b484818108a7bb46bc9d3c3a52))
* **library:** list components with versions, channels and history ([1c1e1b5](https://github.com/Disble/stylistic-hub/commit/1c1e1b5d108f48174a42a7d635838c78bff1ce12))
* **library:** show the library screen with install and uninstall ([ce72df3](https://github.com/Disble/stylistic-hub/commit/ce72df32c9e57bddfebde42a55e154cd0d58bc5c))
* **modules:** add --module for development ([0aff592](https://github.com/Disble/stylistic-hub/commit/0aff592e7863fc72ad1fbbc223d1295b5bf51c8c))
* **modules:** switch module versions with a health check ([f162e65](https://github.com/Disble/stylistic-hub/commit/f162e656fb7f86f52cea5fd0407ed4e12d78d459))
* **provider:** say what leaves the machine ([dca49b1](https://github.com/Disble/stylistic-hub/commit/dca49b13683a3f2d0a665220a1a18c54f0955843))
* **release:** pack and sign the server as a component artifact ([a462017](https://github.com/Disble/stylistic-hub/commit/a462017a35ac61316e8c956fd225f0b826d8c167))
* **server:** choose the server and hub channels on the Server screen ([19b110b](https://github.com/Disble/stylistic-hub/commit/19b110b91c1b495c23dd2e00535ed1295d8b2a18))
* **server:** export a diagnostics bundle ([b5d2a8a](https://github.com/Disble/stylistic-hub/commit/b5d2a8a5c0cbf1814fdb9db6ddb336c1cee3ead8))
* **server:** record the minimum reader schema and back up before migrating ([53969f4](https://github.com/Disble/stylistic-hub/commit/53969f43c5a1825f05404acf5309ddee3d415c7d))
* **server:** run the server component with a health check and rollback ([d89fc76](https://github.com/Disble/stylistic-hub/commit/d89fc765cc39f7e36c72a18ca4c5864fbe5e647c))
* **server:** scope module tokens to their declared API groups ([201f96e](https://github.com/Disble/stylistic-hub/commit/201f96ef856e6ad5a7ed720b750235dcfcad4f90))
* **server:** serve each module under /m/<id>/ and list them ([7632476](https://github.com/Disble/stylistic-hub/commit/76324766f76d9b8917175aba5233d1b9c5d4055e))
* **server:** show a rolled-back server and why ([7503191](https://github.com/Disble/stylistic-hub/commit/750319172ea48556b9a52f30cba2eaa0590dd1fa))
* **signing:** add the verification library for signed releases ([d58c8b4](https://github.com/Disble/stylistic-hub/commit/d58c8b4c45957487293df92d9a2ed0c32dbd6f22))
* **supervisor:** hand a crash loop over and halt until the next start ([fc96051](https://github.com/Disble/stylistic-hub/commit/fc96051e8042bed4837c56506184f6b65155ca20))
* **updates:** extract component zips strictly with yauzl ([95731dc](https://github.com/Disble/stylistic-hub/commit/95731dc251cfd850866a03ee8322f1ee2a2747ba))
* **updates:** follow a channel per component, stage rollouts ([6b109df](https://github.com/Disble/stylistic-hub/commit/6b109dfb264f18b2d01633bcf39445828ca9d990))
* **updates:** install and uninstall modules on request ([50d787b](https://github.com/Disble/stylistic-hub/commit/50d787b51191693195bb54156f90306716506a52))
* **updates:** keep the update state atomically and embed the root keys ([ca4b076](https://github.com/Disble/stylistic-hub/commit/ca4b0760fa6f670471033f2455d914c776e9fc33))
* **updates:** serve the verified hub installer to electron-updater ([85b5707](https://github.com/Disble/stylistic-hub/commit/85b5707c247897f32a3b7f813260216ade9d8571))
* **updates:** verify, download and install components from the catalog ([85e1ac7](https://github.com/Disble/stylistic-hub/commit/85e1ac75fc80fa6e672d78a49ca9a440b96cde0d))
* **word:** register module manifests by content hash ([aaeee18](https://github.com/Disble/stylistic-hub/commit/aaeee18f83bb27a4e061d0d4b2c6d6814ee1d8b5))

### Bug Fixes

* **analysis:** make a replayed part completion a no-op ([40e82b1](https://github.com/Disble/stylistic-hub/commit/40e82b1bb1cc54dc54cb38dc785b48201c6843b4))
* **api:** refuse unknown fields in an analysis request ([7311666](https://github.com/Disble/stylistic-hub/commit/7311666454e97ac295832d2f140275f503d3c32d))
* **feedback:** clear the error when a failed feedback run completes ([bbcef02](https://github.com/Disble/stylistic-hub/commit/bbcef02ceca253b9285e3b14d7afde02b8569041))
* **feedback:** fail a feedback whose workflow cannot start ([20cf597](https://github.com/Disble/stylistic-hub/commit/20cf597e8e7e5d7720c43994702556f6142d8d6a))
* **keys:** keep the old key on rotation and publish key list changes ([d5266fc](https://github.com/Disble/stylistic-hub/commit/d5266fc17704cfeb2d3e749a0b18c2511da74c82))
* **modules:** drop a pending check of an uninstalled module ([02e25ae](https://github.com/Disble/stylistic-hub/commit/02e25aeabb6bac4c6d453552bccad35573139b42))
* **modules:** wait for a server that serves modules ([7de6a12](https://github.com/Disble/stylistic-hub/commit/7de6a12f0614c3769e15eac947e266112510b8c8))
* **server:** ignore Restart while a rollback runs ([9ff4025](https://github.com/Disble/stylistic-hub/commit/9ff402511ebe5f57922a75e8f67ebf6a21397e40))
* **server:** mark the analysis_part migration as an expand step ([773667b](https://github.com/Disble/stylistic-hub/commit/773667ba59281569c280f1d91324604e23f6798b))
* **server:** restore the backup at the previous version's schema ([56ce6f1](https://github.com/Disble/stylistic-hub/commit/56ce6f14dc6316e35b3c9d74156228a255bfee62))
* **server:** skip an invalid module instead of stopping ([075d42b](https://github.com/Disble/stylistic-hub/commit/075d42bb7f4c8199dccb7ff84c19f6e54e8d2139))
* **signing:** reject malformed key lists as invalid_list ([c7964df](https://github.com/Disble/stylistic-hub/commit/c7964df8311baa1bffe21135ec4519c9b39550b6))
* **signing:** verify documents with fields added by later versions ([3b3e5c4](https://github.com/Disble/stylistic-hub/commit/3b3e5c4f5fcb5106f4c58f79aa498ffabf5b486e))
* **supervisor:** halt waits for a detached backend ([d63e14f](https://github.com/Disble/stylistic-hub/commit/d63e14f7a2812ee43405b9a0d1907f7f7cc1b79d))
* **updates:** hold the server when the database cannot be read ([4d28d7c](https://github.com/Disble/stylistic-hub/commit/4d28d7c9b14bb71333c7351cd78477080c38101b))
* **updates:** keep a module's registered manifest when pruning versions ([3d55b05](https://github.com/Disble/stylistic-hub/commit/3d55b0567f9ad46898fefaf29571c61a1fe3d655))
* **updates:** load electron-updater through its default export ([dbb7e5a](https://github.com/Disble/stylistic-hub/commit/dbb7e5a79a4b8e3882b0bf5ad2f84dfdf241324e))
* **updates:** record an uninstall with an outcome older hubs read ([4551bae](https://github.com/Disble/stylistic-hub/commit/4551baede37e8c8b9baedeca3ae523c41e7cedf8))
* **updates:** reject Windows name aliases in component zips ([1703555](https://github.com/Disble/stylistic-hub/commit/1703555707592889ad48e1eb53957a324c6e28eb))
* **updates:** serialize state writes ([c57a05e](https://github.com/Disble/stylistic-hub/commit/c57a05e496024d54f472eb1b4b1e9974241a3ffa))
* **updates:** withdraw a served hub installer the channel no longer offers ([3564572](https://github.com/Disble/stylistic-hub/commit/3564572ae7e94cd2d17f5fd7e5a574a2317ecdc3))
