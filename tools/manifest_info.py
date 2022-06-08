#!/usr/bin/env python3

import argparse
import glob
import json


def src_background(manifest):
    background = manifest.get("background")
    if background is None:
        return
    scripts = background.get("scripts")
    if scripts is not None:
        yield from scripts


def src_experiment(manifest):
    experiment_apis = manifest.get("experiment_apis")
    if experiment_apis is None:
        return
    for ns in experiment_apis.values():
        yield ns["schema"]
        parent = ns.get("parent")
        if parent is not None:
            yield parent["script"]


def src_html(manifest):
    for key in ("browser_action", "message_display_action"):
        value = manifest.get(key)
        if value is None:
            continue
        popup = value.get("default_popup")
        if popup is not None:
            yield popup

    options_ui = manifest.get("options_ui")
    if options_ui is not None:
        yield options_ui.get("page")


def src_icon(manifest):
    unique = set()
    icons = manifest.get("values")
    if icons is not None:
        for f in icons.keys():
            unique.add(f)

    for action in ("browser_action", "message_display_action"):
        props = manifest.get(action)
        if props is None:
            continue
        icons = props.get("default_icon")
        if icons is None:
            continue
        for f in icons.values():
            unique.add(f)

    # TODO themed icons
    yield from unique


def src_messages(manifest):
    yield from glob.glob("_locales/*/messages.json")


def src_all(manifest):
    yield "manifest.json"
    for func in (src_background, src_experiment,
                 src_html, src_icon, src_messages):
        yield from func(manifest)


def strip_slash(fil):
    return fil[1:] if fil.startswith("/") else fil


def cmd_src(manifest):
    print(" ".join(map(strip_slash, src_all(manifest))))


def make_arg_parser():
    top = argparse.ArgumentParser()
    commands = top.add_subparsers()

    experiment = commands.add_parser(
        "src",
        help="Extract list of source files from manifest")
    experiment.set_defaults(func=cmd_src)

    top.add_argument(
        "file", help="manifest.json file name")

    return top


if __name__ == '__main__':
    parser = make_arg_parser()
    args = parser.parse_args()
    with open(args.file, "r") as f:
        manifest = json.load(f)

    args.func(manifest)
