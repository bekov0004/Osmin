import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Opens an agent (Claude Code, Codex) in a terminal window, in a project folder, with the task as its first message:
 * the normal interactive agent, which Osmin then follows through its session logs.
 * The first terminal found: Ptyxis (Ubuntu's), GNOME Console, GNOME Terminal, then any x-terminal-emulator.
 */
export function openInTerminal(binary, cwd, args = []) {
    const command = [binary, ...args];
    const quoted = command.map(part => GLib.shell_quote(part)).join(' ');
    const terminals = [
        ['ptyxis', ['ptyxis', '--new-window', '--working-directory', cwd, '--', ...command]],
        ['kgx', ['kgx', `--working-directory=${cwd}`, '-e', quoted]],
        ['gnome-terminal', ['gnome-terminal', `--working-directory=${cwd}`, '--', ...command]],
        ['x-terminal-emulator', ['x-terminal-emulator', '-e', `sh -c ${GLib.shell_quote(`cd ${GLib.shell_quote(cwd)} && ${quoted}`)}`]],
    ];
    for (const [name, argv] of terminals) {
        if (!GLib.find_program_in_path(name))
            continue;
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
        launcher.set_cwd(cwd);
        launcher.spawnv(argv);
        return name;
    }
    throw new Error('No terminal found (Ptyxis, GNOME Console, GNOME Terminal)');
}
