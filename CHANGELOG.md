# Changelog

## [0.4.1](https://github.com/snowdreamtech/setup-unirtm/compare/v0.4.0...v0.4.1) (2026-07-05)


### Bug Fixes

* correctly handle Windows cache path ([9aaad0e](https://github.com/snowdreamtech/setup-unirtm/commit/9aaad0e55a81a0b835adb43067e14ea2bca5be8f))
* skip unirtm install on exact cache hit and enhance cache logging ([d740a73](https://github.com/snowdreamtech/setup-unirtm/commit/d740a73e083a7a881237927629907527076e0a26))
* unify cache path to ~/.local/share/unirtm for all platforms ([963b4de](https://github.com/snowdreamtech/setup-unirtm/commit/963b4de0370b2f43bb416910d050a9f98d710a9d))

## [0.4.0](https://github.com/snowdreamtech/setup-unirtm/compare/v0.3.0...v0.4.0) (2026-06-04)


### Features

* add support for UNIRTM_ENV in cache key generation ([436e727](https://github.com/snowdreamtech/setup-unirtm/commit/436e7279c362ae25cea4d3173b4c12acf850a861))


### Bug Fixes

* bundle action as cjs to avoid dynamic require errors in [@actions](https://github.com/actions) dependencies ([1fb0b83](https://github.com/snowdreamtech/setup-unirtm/commit/1fb0b836177c6a84d6890f971e1d189eb6dffba8))
* bundle action as esm to fix require is not defined error ([fe9c6e1](https://github.com/snowdreamtech/setup-unirtm/commit/fe9c6e194892a14ffaba8376f23ff2a59f2a2f08))
* correctly mock exact cache hit in main.test.ts ([4e2f3f9](https://github.com/snowdreamtech/setup-unirtm/commit/4e2f3f947f2f1aa64f6a3abefbc383f2f8064fc8))
* correctly save CACHE_RESULT state in main.ts ([6d9149f](https://github.com/snowdreamtech/setup-unirtm/commit/6d9149f6a88ad8e37b8dd104e6c0dbe746986d78))

## [0.3.0](https://github.com/snowdreamtech/setup-unirtm/compare/v0.2.4...v0.3.0) (2026-06-02)


### Features

* rename version input to unirtm-version to avoid collisions ([3f7d925](https://github.com/snowdreamtech/setup-unirtm/commit/3f7d92577c2da1c2b2f4739a69b0d8a369226834))

## [0.2.4](https://github.com/snowdreamtech/setup-unirtm/compare/v0.2.3...v0.2.4) (2026-06-02)


### Bug Fixes

* add description to ts-expect-error ([c97d35c](https://github.com/snowdreamtech/setup-unirtm/commit/c97d35c504297f776ec979bc13294b13a6eb980c))
* force release to include recent dependency and lint updates ([cac74e6](https://github.com/snowdreamtech/setup-unirtm/commit/cac74e608646aaee71c6c8907ed92214de391ad8))
* pin jiti version explicitly ([84d67ce](https://github.com/snowdreamtech/setup-unirtm/commit/84d67ce6e07f2c730cdc4a8f6967d79802fd5748))
* replace ts-ignore with ts-expect-error to satisfy linting ([dd15b75](https://github.com/snowdreamtech/setup-unirtm/commit/dd15b75fffc2d0cdafe0caa53bf601509f8e86b5))

## [0.2.3](https://github.com/snowdreamtech/setup-unirtm/compare/v0.2.2...v0.2.3) (2026-06-02)


### Bug Fixes

* **cache:** resolve cache key and binary recovery issues ([7275ddf](https://github.com/snowdreamtech/setup-unirtm/commit/7275ddf7ebf71794f51a15c1a565216e827de2af))

## [0.2.2](https://github.com/snowdreamtech/setup-unirtm/compare/v0.2.1...v0.2.2) (2026-05-29)


### Bug Fixes

* strictly defer version resolution and bypass GitHub API for npm/pip ([64a934c](https://github.com/snowdreamtech/setup-unirtm/commit/64a934cb98cfd304c6accfa67fe5922c7ac8f397))

## [0.2.1](https://github.com/snowdreamtech/setup-unirtm/compare/v0.2.0...v0.2.1) (2026-05-29)


### Bug Fixes

* defer version resolution for npm and pip ([a220f4e](https://github.com/snowdreamtech/setup-unirtm/commit/a220f4e6a5f500426f1d63414bfc3291a192ee93))

## [0.2.0](https://github.com/snowdreamtech/setup-unirtm/compare/v0.1.15...v0.2.0) (2026-05-29)


### Features

* resolve 'latest' to absolute latest release instead of second latest ([4f47865](https://github.com/snowdreamtech/setup-unirtm/commit/4f478651eedaf562c7728b2b5f8e40e5ab31c1b4))

## [0.1.15](https://github.com/snowdreamtech/setup-unirtm/compare/v0.1.14...v0.1.15) (2026-05-25)


### Bug Fixes

* force release 0.1.15 to include ci improvements ([ceb3c7f](https://github.com/snowdreamtech/setup-unirtm/commit/ceb3c7fe6764f9823ed10da935f3e93e694cb225))

## [0.1.14](https://github.com/snowdreamtech/setup-unirtm/compare/v0.1.13...v0.1.14) (2026-05-25)


### Bug Fixes

* fetch second latest version by default to resolve chicken-and-egg issue ([fe5c71f](https://github.com/snowdreamtech/setup-unirtm/commit/fe5c71fec09ad92dbcf467b5fd57441ed15e4f34))
