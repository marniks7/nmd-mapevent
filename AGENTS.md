## Command usage

Prefer IntelliJ file tools for reading, searching, and modifying project files.

Do not use Node.js, Python, Bash heredocs, or temporary scripts merely to inspect or edit files when ordinary project file operations are sufficient.

Keep all file operations inside the current project workspace.
Do not access or modify files outside the project.

## Browser automation

`localhost:8080` is reserved for the user's local development session. Never open it, inspect it, connect DevTools to it, or start another server on that port.

For automated browser checks:

- Start the isolated server with `npm run start:headless`; it listens only on `127.0.0.1:8091`.
- Use a dedicated headless Chrome profile under `.cache/`, never the user's default Chrome profile.
- Use a dedicated remote-debugging port other than `9222`.
- Stop the headless browser and isolated server after the check.
