# Local server changelog

## [server-v1.0.0](https://github.com/Disble/stylistic-hub/compare/server-v0.0.1...server-v1.0.0) (2026-10-18)

### ⚠ BREAKING CHANGES

* **api:** between the v1 documents before and after.

### Features

* **release:** pack and sign the server as a component artifact ([a462017](https://github.com/Disble/stylistic-hub/commit/a462017a35ac61316e8c956fd225f0b826d8c167))
* **server:** record the minimum reader schema and back up before migrating ([53969f4](https://github.com/Disble/stylistic-hub/commit/53969f43c5a1825f05404acf5309ddee3d415c7d))
* **server:** scope module tokens to their declared API groups ([201f96e](https://github.com/Disble/stylistic-hub/commit/201f96ef856e6ad5a7ed720b750235dcfcad4f90))
* **server:** serve each module under /m/<id>/ and list them ([7632476](https://github.com/Disble/stylistic-hub/commit/76324766f76d9b8917175aba5233d1b9c5d4055e))

### Bug Fixes

* **analysis:** make a replayed part completion a no-op ([40e82b1](https://github.com/Disble/stylistic-hub/commit/40e82b1bb1cc54dc54cb38dc785b48201c6843b4))
* **api:** refuse unknown fields in an analysis request ([7311666](https://github.com/Disble/stylistic-hub/commit/7311666454e97ac295832d2f140275f503d3c32d))
* **feedback:** clear the error when a failed feedback run completes ([bbcef02](https://github.com/Disble/stylistic-hub/commit/bbcef02ceca253b9285e3b14d7afde02b8569041))
* **feedback:** fail a feedback whose workflow cannot start ([20cf597](https://github.com/Disble/stylistic-hub/commit/20cf597e8e7e5d7720c43994702556f6142d8d6a))
* **server:** mark the analysis_part migration as an expand step ([773667b](https://github.com/Disble/stylistic-hub/commit/773667ba59281569c280f1d91324604e23f6798b))
* **server:** skip an invalid module instead of stopping ([075d42b](https://github.com/Disble/stylistic-hub/commit/075d42bb7f4c8199dccb7ff84c19f6e54e8d2139))

## [server-v1.0.0-beta.2](https://github.com/Disble/stylistic-hub/compare/server-v1.0.0-beta.1...server-v1.0.0-beta.2) (2026-10-18)

### Features

* **server:** scope module tokens to their declared API groups ([201f96e](https://github.com/Disble/stylistic-hub/commit/201f96ef856e6ad5a7ed720b750235dcfcad4f90))
* **server:** serve each module under /m/<id>/ and list them ([7632476](https://github.com/Disble/stylistic-hub/commit/76324766f76d9b8917175aba5233d1b9c5d4055e))

### Bug Fixes

* **server:** skip an invalid module instead of stopping ([075d42b](https://github.com/Disble/stylistic-hub/commit/075d42bb7f4c8199dccb7ff84c19f6e54e8d2139))

## [server-v1.0.0-beta.1](https://github.com/Disble/stylistic-hub/compare/server-v0.1.0-beta.2...server-v1.0.0-beta.1) (2026-10-18)

### ⚠ BREAKING CHANGES

* **api:** between the v1 documents before and after.

### Bug Fixes

* **analysis:** make a replayed part completion a no-op ([40e82b1](https://github.com/Disble/stylistic-hub/commit/40e82b1bb1cc54dc54cb38dc785b48201c6843b4))
* **api:** refuse unknown fields in an analysis request ([7311666](https://github.com/Disble/stylistic-hub/commit/7311666454e97ac295832d2f140275f503d3c32d))
* **feedback:** clear the error when a failed feedback run completes ([bbcef02](https://github.com/Disble/stylistic-hub/commit/bbcef02ceca253b9285e3b14d7afde02b8569041))
* **feedback:** fail a feedback whose workflow cannot start ([20cf597](https://github.com/Disble/stylistic-hub/commit/20cf597e8e7e5d7720c43994702556f6142d8d6a))
* **server:** mark the analysis_part migration as an expand step ([773667b](https://github.com/Disble/stylistic-hub/commit/773667ba59281569c280f1d91324604e23f6798b))

## [server-v0.1.0-beta.2](https://github.com/Disble/stylistic-hub/compare/server-v0.1.0-beta.1...server-v0.1.0-beta.2) (2026-10-18)

### Features

* **server:** record the minimum reader schema and back up before migrating ([53969f4](https://github.com/Disble/stylistic-hub/commit/53969f43c5a1825f05404acf5309ddee3d415c7d))

## [server-v0.1.0-beta.1](https://github.com/Disble/stylistic-hub/compare/server-v0.0.1...server-v0.1.0-beta.1) (2026-10-18)

### Features

* **release:** pack and sign the server as a component artifact ([a462017](https://github.com/Disble/stylistic-hub/commit/a462017a35ac61316e8c956fd225f0b826d8c167))
