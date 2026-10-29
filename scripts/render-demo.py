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
            elif token == '\x1b[?25l':
                snapshots.append('\n'.join(''.join(line).rstrip() for line in rows).rstrip())
            while len(rows) <= row:
                rows.append([])
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
    return snapshots


def choose_frames(snapshots):
    markers = [
        ('❯ ➕ Add widget', 1500),
        ('❯ ✏ Edit widget', 900),
        ('❯ Pocket Garden · Pocket Garden Controls · Medium', 1500),
        ('❯ Watering reminder: On', 1800),
        ('❯ Garden caption: Morning garden', 1400),
        ('Garden caption: Morning garden → Human-friendly garden', 2700),
        ('❯ Save changes · 1', 2100),
        ('✓ Changes saved', 2800),
    ]
    chosen = []
    start = 0
    for marker, duration in markers:
        for index in range(start, len(snapshots)):
            if marker in snapshots[index]:
                chosen.append((snapshots[index], duration))
                start = index + 1
                break
        else:
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


def render(screen, font, emoji):
    frame = Image.new('RGB', (960, 530), '#101319')
    draw = ImageDraw.Draw(frame)
    draw.rounded_rectangle((12, 12, 948, 518), radius=13, fill='#191e27', outline='#303743')
    draw.rounded_rectangle((13, 13, 947, 52), radius=12, fill='#242a34')
    draw.rectangle((13, 39, 947, 52), fill='#242a34')
    for x, color in [(34, '#8a686c'), (53, '#92866a'), (72, '#6c887b')]:
        draw.ellipse((x, 28, x + 9, 37), fill=color)
    small = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 13)
    draw.text((107, 24), 'widgetctl  ·  iOS 27.0 simulator', font=small, fill='#a5afbd')
    for index, line in enumerate(visible_lines(screen)):
        color = '#a9dbb9' if line.startswith('✓') else '#8cc8ff' if line.startswith('❯') else '#cbd3df'
        draw_line(draw, (38, 75 + index * 27), line, font, emoji, color)
    draw.line((38, 468, 922, 468), fill='#303743')
    draw.text((38, 486), 'Recorded CLI session · trimmed + sped up', font=small, fill='#8c97a7')
    return frame


def main():
    parser = argparse.ArgumentParser(description='Render an authentic trimmed PTY recording as docs/assets/usage.gif. Requires Pillow and macOS system fonts.')
    parser.add_argument('recording', type=Path, help='Raw script/PTY log from the recorded Pocket Garden edit session')
    parser.add_argument('--output', type=Path, default=Path('docs/assets/usage.gif'))
    parser.add_argument('--proof-dir', type=Path, default=Path('.local/distribution/demo'))
    args = parser.parse_args()
    snapshots = replay(args.recording.read_text())
    selected = choose_frames(snapshots)
    args.proof_dir.mkdir(parents=True, exist_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 20)
    emoji = ImageFont.truetype('/System/Library/Fonts/Apple Color Emoji.ttc', 20)
    frames = [render(screen, font, emoji) for screen, _ in selected]
    for index, (frame, (screen, _)) in enumerate(zip(frames, selected)):
        frame.save(args.proof_dir / f'frame-{index:02}.png')
        (args.proof_dir / f'frame-{index:02}.txt').write_text(screen)
    frames[0].save(args.output, save_all=True, append_images=frames[1:], duration=[duration for _, duration in selected], loop=0, optimize=True, disposal=2)
    with Image.open(args.output) as result:
        print(f'{args.output}: {result.width}×{result.height}, {result.n_frames} frames, {sum(duration for _, duration in selected) / 1000:.1f}s, {args.output.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
