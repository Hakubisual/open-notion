# Contributing to Acard

Thanks for helping. Bug reports, ideas, documentation fixes and pull requests are all welcome.

## Before you start

- **Bugs and ideas:** open an [issue](https://github.com/Hakubisual/open-notion-acard/issues/new/choose) with the matching template. Search first; a
  duplicate gets closed with a link.
- **Security problems:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).
- **Bigger changes:** open an issue first so we can agree on the approach before you write a lot of code.

## Set up

Requirements: [Bun](https://bun.sh) 1.3 or newer and Git.

```sh
git clone https://github.com/Hakubisual/open-notion-acard.git
cd open-notion-acard
bun install
bun run build     # web app into dist/, server core into .build/
bun test
ACARD_DATA_DIR=./data ACARD_APP_DIR=./dist ACARD_LANG=en bun local/main.ts
```

The desktop client lives in `desktop/` (`bun install`, then `bun run start`). The [architecture page](docs/architecture.md)
explains how the pieces fit.

## Pull requests

- Keep each pull request to one change, and explain the why in the description.
- Add or update a test in `tests/` when you change behaviour. `bun test` must pass.
- `bun run build` must pass. It enforces size budgets for the editor and reader (`perf-budget.json`); do not raise a
  budget to make room, make the code smaller or load it lazily.
- Interface text lives in `src/i18n/en.json`, `ko.json` and `zh.json`. Add new strings to all three; English is
  fine as a placeholder in the other two.
- No new runtime dependencies without discussing it in an issue first. The web app uses no front-end framework.
- Never commit secrets, real user data or personal paths.

## Code style

- TypeScript or plain modern JavaScript, matching the file you are editing.
- Short, plain comments that explain why, not what.
- Small, readable functions over clever ones.

## License

By contributing you agree that your contribution is licensed under the [GNU Affero General Public License v3.0](LICENSE).
