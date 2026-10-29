import argparse
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def replay(recording):
    rows = [[]]
    row = column = 0
    snapshots = []
    for token in re.findall(r'\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]+', recording):
        if token.startswith('\x1b['):
            command = token[-1]
            argument = token[2:-1]
            amount = int(argument or '1') if argument.isdigit() or not argument else 1
            if command == 'A':
                row = max(0, row - amount)
            elif command == 'B':
                row += amount
            elif command == 'G':
                column = amount - 1
            elif command == 'K':
                rows[row] = [] if argument == '2' else rows[row][:column]
            while len(rows) <= row:
                rows.append([])
            if token in ('\x1b[?25l', '\x1b[?25h') or command == 'G':
                screen = '\n'.join(''.join(line).rstrip() for line in rows).rstrip()
                if not snapshots or snapshots[-1] != screen:
                    snapshots.append(screen)
        else:
            for character in token:
                if character == '\n':
                    row += 1
                    column = 0
                elif character == '\r':
                    column = 0
                elif character == '\b':
                    column = max(0, column - 1)
                elif character == '\ufe0f':
                    continue
                else:
                    while len(rows) <= row:
                        rows.append([])
                    while len(rows[row]) <= column:
                        rows[row].append(' ')
                    rows[row][column] = character
                    column += 1
                while len(rows) <= row:
                    rows.append([])
    final = '\n'.join(''.join(line).rstrip() for line in rows).rstrip()
    if final and (not snapshots or snapshots[-1] != final):
        snapshots.append(final)
    return snapshots


def choose_frames(snapshots):
    markers = [
        ('❯ ➕ Add widget', 'empty', 'Add', 1000, True),
        ('❯ Pocket Garden', 'empty', 'Add', 1100, False),
        ('❯ Pocket Garden Controls', 'empty', 'Add', 1000, False),
        ('❯ Medium', 'empty', 'Add', 1200, True),
        ('✓ Pocket Garden Controls · Medium ready', 'added', 'Add', 1800, True),
        ('❯ ✏ Edit widget', 'added', 'Edit', 1000, True),
        ('❯ Pocket Garden · Pocket Garden Controls · Medium', 'added', 'Edit', 1200, True),
        ('❯ Watering reminder: On', 'added', 'Edit', 1200, True),
        ('❯ Garden caption: Morning garden', 'added', 'Edit', 1300, True),
        ('Garden caption: Morning garden → Human-friendly garden', 'added', 'Edit', 1700, True),
        ('❯ Save changes · 1', 'added', 'Edit', 1300, True),
        ('✓ Changes saved', 'edited', 'Edit', 1900, True),
        ('❯ 🗑 Remove widget', 'edited', 'Remove', 1000, True),
        ('❯ Pocket Garden · Pocket Garden Controls · Medium', 'edited', 'Remove', 1200, True),
        ('? Remove Pocket Garden · Pocket Garden Controls · Medium?', 'edited', 'Remove', 1400, True),
        ('✓ Pocket Garden · Pocket Garden Controls · Medium removed', 'removed', 'Remove', 2000, True),
    ]
    current_screens = ['\n'.join(visible_lines(screen)) for screen in snapshots]
    chosen = []
    start = 0
    for marker_index, (marker, state, stage, duration, required) in enumerate(markers):
        end = len(snapshots)
        if not required:
            next_required = next(item[0] for item in markers[marker_index + 1:] if item[4])
            end = next((index for index in range(start, end) if next_required in current_screens[index]), end)
        for index in range(start, end):
            current = current_screens[index]
            if marker.startswith('✓') and '? What would you like to do?' not in current:
                continue
            if marker in current:
                chosen.append((snapshots[index], duration, state, stage))
                start = index + 1
                break
        else:
            if required:
                raise ValueError(f'Recording is missing the next required frame: {marker}')
    return chosen


def visible_lines(screen):
    lines = screen.splitlines()
    starts = [index for index, line in enumerate(lines) if line.startswith('? ')]
    if starts:
        start = starts[-1]
        previous = lines[max(0, start - 3):start]
        context = [line for line in previous if line.startswith('Pocket Garden') or line.startswith('✓')]
        return context + ([''] if context else []) + lines[start:]
    return lines[-16:]


def draw_line(draw, position, text, font, emoji, color):
    x, y = position
    for character in text:
        if ord(character) >= 0x1F000 or character in '➕✏':
            draw.text((x, y - 1), character, font=emoji, embedded_color=True)
            x += 24
        else:
            draw.text((x, y), character, font=font, fill=color)
            x += draw.textlength(character, font=font)


def render(screen, font, emoji, simulator):
    width, height = 1280, 720
    terminal_right = 804
    frame = Image.new('RGB', (width, height), '#101319')
    draw = ImageDraw.Draw(frame)
    bottom = height - 20
    draw.rounded_rectangle((12, 12, terminal_right, bottom), radius=13, fill='#191e27', outline='#303743')
    draw.rounded_rectangle((13, 13, terminal_right - 1, 52), radius=12, fill='#242a34')
    draw.rectangle((13, 39, terminal_right - 1, 52), fill='#242a34')
    for x, color in [(34, '#8a686c'), (53, '#92866a'), (72, '#6c887b')]:
        draw.ellipse((x, 28, x + 9, 37), fill=color)
    for index, line in enumerate(visible_lines(screen)):
        color = '#a9dbb9' if line.startswith('✓') else '#8cc8ff' if line.startswith('❯') else '#cbd3df'
        draw_line(draw, (32, 75 + index * 29), line, font, emoji, color)
    phone = simulator.copy()
    phone.thumbnail((420, 680), Image.Resampling.LANCZOS)
    px, py = 1048 - phone.width // 2, 16
    draw.rounded_rectangle((px - 4, py - 4, px + phone.width + 4, py + phone.height + 4), radius=18, fill='#303743')
    frame.paste(phone, (px, py))
    return frame


def main():
    parser = argparse.ArgumentParser(description='Render an authentic trimmed PTY recording as docs/assets/usage.gif. Requires Pillow and macOS system fonts.')
    parser.add_argument('recording', type=Path, help='Raw script/PTY log from the recorded Pocket Garden add, edit, remove session')
    parser.add_argument('--output', type=Path, default=Path('docs/assets/usage.gif'))
    parser.add_argument('--proof-dir', type=Path, default=Path('.local/distribution/demo'))
    for state in ('empty', 'added', 'edited', 'removed'):
        parser.add_argument(f'--{state}-simulator', type=Path, required=True, help=f'Real full Home Screen capture in the {state} state')
    args = parser.parse_args()
    snapshots = replay(args.recording.read_text())
    selected = choose_frames(snapshots)
    if sum(duration for _, duration, _, _ in selected) > 30000:
        parser.error('Demo playback must be no longer than 30 seconds')
    args.proof_dir.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 20)
    emoji = ImageFont.truetype('/System/Library/Fonts/Apple Color Emoji.ttc', 20)
    captures = {state: Image.open(getattr(args, f'{state}_simulator')).convert('RGB')
                for state in ('empty', 'added', 'edited', 'removed')}
    if len({capture.size for capture in captures.values()}) != 1:
        parser.error('Simulator captures must have matching dimensions')
    frames = [render(screen, font, emoji, captures[state])
              for screen, _, state, stage in selected]
    for index, (frame, (screen, _, state, stage)) in enumerate(zip(frames, selected)):
        frame.save(args.proof_dir / f'frame-{index:02}.png')
        (args.proof_dir / f'frame-{index:02}.txt').write_text(screen)
    (args.proof_dir / 'stages.txt').write_text('\n'.join(
        f'{index:02} {stage} {state} {duration}ms' for index, (_, duration, state, stage) in enumerate(selected)))
    frames[0].save(args.output, save_all=True, append_images=frames[1:], duration=[duration for _, duration, _, _ in selected], loop=0, optimize=True, disposal=1)
    with Image.open(args.output) as result:
        print(f'{args.output}: {result.width}×{result.height}, {result.n_frames} frames, {sum(duration for _, duration, _, _ in selected) / 1000:.1f}s, {args.output.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
