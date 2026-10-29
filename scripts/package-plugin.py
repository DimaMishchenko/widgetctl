import argparse
import hashlib
import json
import zipfile
from pathlib import Path


def package_plugin(root, output):
    manifest_paths = ["plugin.json", ".claude-plugin/plugin.json"]
    version = json.loads((root / "package.json").read_text())["version"]
    for name in manifest_paths:
        manifest = json.loads((root / name).read_text())
        if manifest.get("name") != "widgetctl" or manifest.get("version") != version:
            raise ValueError(f"{name} must match package.json name and version")
    files = manifest_paths + [
        ".agents/plugins/marketplace.json",
        ".claude-plugin/marketplace.json",
        "LICENSE",
        "assets/plugin-icon.svg",
    ]
    skill_root = root / "skills"
    for path in sorted(skill_root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Plugin resources cannot be symlinks: {path}")
        if path.is_file():
            files.append(path.relative_to(root).as_posix())
    if "skills/widgetctl/SKILL.md" not in files:
        raise ValueError("The widgetctl skill is missing")
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"widgetctl-plugin-{version}.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in sorted(files):
            source = root / name
            if source.is_symlink() or not source.resolve().is_relative_to(root.resolve()):
                raise ValueError(f"Plugin file escapes the package: {name}")
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, source.read_bytes())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / f"{archive.name}.sha256").write_text(f"{digest}  {archive.name}\n")
    return archive


def main():
    parser = argparse.ArgumentParser(description="Build the version-matched widgetctl agent plugin ZIP without publishing.")
    parser.add_argument("--output", type=Path, help="Output directory (default: .local/release)")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    print(package_plugin(root, args.output or root / ".local/release"))


if __name__ == "__main__":
    main()
