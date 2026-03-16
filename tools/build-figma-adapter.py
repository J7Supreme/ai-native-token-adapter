#!/usr/bin/env python3

import argparse
import copy
import json
import os
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple


PRIMITIVE_SOURCE_KEYS = ("Primitive", "primitive", "Base", "base", "Global", "global")
SUPPORTED_INPUT_FORMATS = ("auto", "token-studio-native", "figma-export", "ai-native")


def is_token_node(node: Any) -> bool:
    return isinstance(node, dict) and ("$value" in node or "value" in node)


def get_token_value(node: Dict[str, Any]) -> Any:
    return node.get("$value", node.get("value"))


def infer_type_from_value(raw_value: Any) -> str:
    if isinstance(raw_value, bool):
        return "boolean"
    if isinstance(raw_value, (int, float)):
        return "number"
    if isinstance(raw_value, dict):
        if {"type", "angle", "stops"}.issubset(raw_value.keys()):
            return "gradient"
        return "string"
    if isinstance(raw_value, str):
        if raw_value == "[MISSING]":
            return "string"
        if raw_value.startswith("#") or raw_value.lower().startswith("rgb"):
            return "color"
        if raw_value.endswith("px"):
            return "dimension"
        lowered = raw_value.lower()
        if lowered in {"true", "false"}:
            return "boolean"
        try:
            float(raw_value)
            return "number"
        except ValueError:
            return "string"
    return "string"


def infer_type_from_path(path: str) -> Optional[str]:
    if any(
        segment in path
        for segment in (
            ".iconSize",
            ".padding",
            ".gap",
            ".height",
            ".width",
            ".paddingX",
            ".paddingY",
            ".paddingTop",
            ".dragHandleWidth",
            ".dragHandleHeight",
            ".closeButtonSize",
            ".contentTopGap",
            ".fieldPaddingX",
            ".fieldHeight",
            ".sectionGap",
            ".actionGap",
            ".rowGap",
        )
    ):
        return "dimension"
    if any(
        segment in path
        for segment in (".background", ".text", ".stroke", ".border", ".fill", ".backdrop", ".logo", ".icon")
    ):
        return "color"
    if ".spacing." in path:
        return "spacing"
    if ".size." in path:
        return "sizing"
    if ".radius." in path:
        return "borderRadius"
    return None


def title_case(name: str) -> str:
    value = str(name or "").strip()
    return value[:1].upper() + value[1:] if value else value


def normalize_theme_id(name: str) -> str:
    return re.sub(r"\s+", "-", str(name or "").strip().lower())


def as_token_type(raw_type: Any) -> str:
    if raw_type is None:
        return "string"
    normalized = str(raw_type).strip()
    upper = normalized.upper()
    if upper == "COLOR":
        return "color"
    if upper == "FLOAT":
        return "number"
    if upper == "BOOLEAN":
        return "boolean"
    if upper == "STRING":
        return "string"
    return normalized


def ensure_token_dict(raw_value: Any, raw_type: Any = None, description: str = "") -> Dict[str, Any]:
    if is_token_node(raw_value):
        token = copy.deepcopy(raw_value)
        token["$value"] = get_token_value(token)
        token.pop("value", None)
        token.setdefault("$description", description)
        token.setdefault("$type", raw_type or infer_type_from_value(token["$value"]))
        return token

    token_value = copy.deepcopy(raw_value)
    token_type = raw_type or infer_type_from_value(token_value)
    return {
        "$type": as_token_type(token_type),
        "$value": token_value,
        "$description": description,
    }


def insert_token_path(root: Dict[str, Any], path: str, token: Dict[str, Any]) -> None:
    parts = [part for part in str(path or "").split("/") if part]
    if not parts:
        return
    cursor = root
    for part in parts[:-1]:
        next_value = cursor.get(part)
        if not isinstance(next_value, dict) or is_token_node(next_value):
            next_value = {}
            cursor[part] = next_value
        cursor = next_value
    cursor[parts[-1]] = token


def color_object_to_hex(color: Any) -> Optional[str]:
    if not isinstance(color, dict):
        return None
    try:
        r = round(float(color.get("r", 0)) * 255)
        g = round(float(color.get("g", 0)) * 255)
        b = round(float(color.get("b", 0)) * 255)
    except (TypeError, ValueError):
        return None
    return f"#{r:02X}{g:02X}{b:02X}"


def figma_paint_to_token_value(paint: Any) -> Optional[Any]:
    if not isinstance(paint, dict):
        return None
    paint_type = str(paint.get("type") or "").upper()
    if paint_type == "SOLID":
        return color_object_to_hex(paint.get("color"))
    if not paint_type.startswith("GRADIENT"):
        return None

    stops = []
    for stop in paint.get("gradientStops", []) or []:
        if not isinstance(stop, dict):
            continue
        stop_color = stop.get("color")
        color_value = color_object_to_hex(stop_color)
        if not color_value:
            continue
        stops.append(
            {
                "position": stop.get("position", 0),
                "color": color_value,
            }
        )
    return {
        "type": "linear",
        "angle": 180,
        "stops": stops,
    } if stops else None


def get_mode_descriptors(collection: Dict[str, Any], default_mode_name: str) -> List[Dict[str, Any]]:
    descriptors: List[Dict[str, Any]] = []
    for mode in collection.get("modes", []) or []:
        if not isinstance(mode, dict):
            continue
        raw_name = mode.get("name") or mode.get("modeId")
        if not raw_name:
            continue
        name = title_case(str(raw_name))
        mode_id = str(mode.get("modeId") or "")
        descriptors.append(
            {
                "name": name,
                "id": mode_id,
                "lookup_keys": [key for key in (name, mode_id, normalize_theme_id(name), name.lower()) if key],
            }
        )
    if descriptors:
        return descriptors
    fallback_name = title_case(default_mode_name)
    return [
        {
            "name": fallback_name,
            "id": "",
            "lookup_keys": [fallback_name, normalize_theme_id(fallback_name), fallback_name.lower()],
        }
    ]


def value_for_mode(values_by_mode: Any, descriptor: Dict[str, Any]) -> Any:
    if not isinstance(values_by_mode, dict):
        return None
    for key in descriptor.get("lookup_keys", []):
        if key in values_by_mode:
            return values_by_mode[key]
    return None


def get_primitive_source(source_data: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    for key in PRIMITIVE_SOURCE_KEYS:
        value = source_data.get(key)
        if isinstance(value, dict):
            if "primitive" in value and isinstance(value["primitive"], dict):
                return "primitive", value["primitive"]
            return "primitive", value
    return "primitive", {}


def get_declared_themes(source_data: Dict[str, Any]) -> List[Dict[str, str]]:
    themes = source_data.get("$themes")
    if not isinstance(themes, list):
        return []

    normalized: List[Dict[str, str]] = []
    seen = set()
    for theme in themes:
        if not isinstance(theme, dict):
            continue
        raw_name = theme.get("name") or theme.get("id")
        if not raw_name:
            continue
        name = title_case(str(raw_name))
        theme_id = normalize_theme_id(theme.get("id") or raw_name)
        if theme_id in seen:
            continue
        seen.add(theme_id)
        normalized.append({"id": theme_id, "name": name})
    return normalized


def get_theme_sources(source_data: Dict[str, Any]) -> List[Tuple[str, Dict[str, Any]]]:
    declared_themes = get_declared_themes(source_data)
    if declared_themes:
        outputs: List[Tuple[str, Dict[str, Any]]] = []
        for theme in declared_themes:
            theme_root = source_data.get(theme["name"])
            if not isinstance(theme_root, dict):
                theme_root = source_data.get(theme["id"])
            if isinstance(theme_root, dict):
                outputs.append((theme["name"], theme_root))
        if outputs:
            return outputs

    discovered: List[Tuple[str, Dict[str, Any]]] = []
    primitive_key, _ = get_primitive_source(source_data)
    for key, value in source_data.items():
        if key.startswith("$") or key == primitive_key or "/" in key or not isinstance(value, dict):
            continue
        discovered.append((title_case(key), value))
    return discovered


def iter_collection_names(theme_sources: Iterable[Tuple[str, Dict[str, Any]]]) -> List[str]:
    discovered = []
    seen = set()
    for _theme_name, theme_root in theme_sources:
        for key, value in theme_root.items():
            if key.startswith("$") or not isinstance(value, dict):
                continue
            if key not in seen:
                seen.add(key)
                discovered.append(key)
    return discovered


def normalize_alias(raw_value: Any, theme_name: str) -> Any:
    if not (isinstance(raw_value, str) and raw_value.startswith("{") and raw_value.endswith("}")):
        return raw_value
    ref_path = raw_value[1:-1]
    if ref_path.startswith("primitive."):
        return raw_value
    if ref_path.startswith(("semantic.", "pattern.", "component.")):
        collection, remainder = ref_path.split(".", 1)
        return "{" + f"{collection}/{theme_name}.{remainder}" + "}"
    return raw_value


def token_set_key(collection_name: str, theme_name: str) -> str:
    return f"{collection_name}/{normalize_theme_id(theme_name)}"


def normalize_nested_value(raw_value: Any, theme_name: str) -> Any:
    if isinstance(raw_value, dict):
        normalized: Dict[str, Any] = {}
        for key, value in raw_value.items():
            normalized[key] = normalize_nested_value(value, theme_name)
        return normalized
    if isinstance(raw_value, list):
        return [normalize_nested_value(item, theme_name) for item in raw_value]
    return normalize_alias(raw_value, theme_name)


def normalize_tree(obj: Dict[str, Any], prefix: str, theme_name: str) -> Dict[str, Any]:
    normalized: Dict[str, Any] = {}
    for key, value in obj.items():
        if key.startswith("$"):
            normalized[key] = copy.deepcopy(value)
            continue
        path = f"{prefix}.{key}" if prefix else key
        if is_token_node(value):
            token = copy.deepcopy(value)
            token["$value"] = normalize_nested_value(get_token_value(token), theme_name)
            token.pop("value", None)
            token.setdefault("$description", "")
            token.setdefault("$type", infer_type_from_path(path) or infer_type_from_value(token["$value"]))
            normalized[key] = token
        elif isinstance(value, dict):
            normalized[key] = normalize_tree(value, path, theme_name)
        else:
            normalized[key] = copy.deepcopy(value)
    return normalized


def flatten_tokens(obj: Dict[str, Any], prefix: str = "") -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for key, value in obj.items():
        if key.startswith("$"):
            continue
        path = f"{prefix}.{key}" if prefix else key
        if is_token_node(value):
            out[path] = value
        elif isinstance(value, dict):
            out.update(flatten_tokens(value, path))
    return out


def refine_alias_types(payload: Dict[str, Any]) -> None:
    flat: Dict[str, Dict[str, Any]] = {}
    for top_key, top_value in payload.items():
        if top_key.startswith("$"):
            continue
        flat.update(flatten_tokens(top_value, top_key))

    cache: Dict[str, Optional[str]] = {}

    def infer(path: str) -> Optional[str]:
        if path in cache:
            return cache[path]
        node = flat.get(path)
        if not node:
            return None
        explicit = node.get("$type")
        raw_value = node.get("$value")
        if isinstance(raw_value, str) and raw_value.startswith("{") and raw_value.endswith("}"):
            ref_path = raw_value[1:-1]
            ref_type = infer(ref_path)
            if ref_type:
                cache[path] = ref_type
                return ref_type
        cache[path] = explicit
        return explicit

    for path, node in flat.items():
        raw_value = node.get("$value")
        if isinstance(raw_value, str) and raw_value.startswith("{") and raw_value.endswith("}"):
            inferred = infer(path)
            if inferred and node.get("$type") != inferred:
                node["$type"] = inferred


def build_payload_from_token_source(source_data: Dict[str, Any]) -> Dict[str, Any]:
    primitive_output_key, primitive_source = get_primitive_source(source_data)
    theme_sources = get_theme_sources(source_data)
    collection_names = iter_collection_names(theme_sources)

    payload: Dict[str, Any] = {
        primitive_output_key: {
            primitive_output_key: normalize_tree(primitive_source, primitive_output_key, "base")
        }
    }

    for theme_name, theme_root in theme_sources:
        theme_id = normalize_theme_id(theme_name)
        for collection in collection_names:
            payload[token_set_key(collection, theme_name)] = normalize_tree(
                theme_root.get(collection, {}),
                collection,
                theme_id,
            )

    themes = []
    for theme_name, _theme_root in theme_sources:
        theme_id = normalize_theme_id(theme_name)
        selected_token_sets = {primitive_output_key: "enabled"}
        for collection in collection_names:
            for other_theme_name, _ in theme_sources:
                selected_token_sets[token_set_key(collection, other_theme_name)] = (
                    "enabled" if other_theme_name == theme_name else "disabled"
                )
        themes.append(
            {
                "id": theme_id,
                "name": theme_name,
                "selectedTokenSets": selected_token_sets,
            }
        )
    payload["$themes"] = themes
    payload["$metadata"] = {
        "tokenSetOrder": [
            primitive_output_key,
            *[
                token_set_key(collection, theme_name)
                for collection in collection_names
                for theme_name, _theme_root in theme_sources
            ],
        ]
    }
    refine_alias_types(payload)
    return payload


def build_payload_from_figma_export(source_data: Dict[str, Any]) -> Dict[str, Any]:
    collections = source_data.get("collections")
    if not isinstance(collections, list):
        raise ValueError('figma-export input must contain a top-level "collections" array')

    payload: Dict[str, Any] = {"primitive": {"primitive": {}}}
    theme_names: List[str] = []
    selected_by_theme: Dict[str, Dict[str, str]] = {}
    token_set_order = ["primitive"]
    top_level_styles = source_data.get("styles", [])
    if not isinstance(top_level_styles, list):
        top_level_styles = []

    def register_theme_token_set(mode_name: str, output_token_set_key: str) -> None:
        if mode_name not in theme_names:
            theme_names.append(mode_name)
        if output_token_set_key not in token_set_order:
            token_set_order.append(output_token_set_key)
        selected = selected_by_theme.setdefault(mode_name, {"primitive": "enabled"})
        selected[output_token_set_key] = "enabled"

    def get_or_create_token_set(output_token_set_key: str) -> Dict[str, Any]:
        existing = payload.get(output_token_set_key)
        if isinstance(existing, dict):
            return existing
        token_set_root: Dict[str, Any] = {}
        payload[output_token_set_key] = token_set_root
        return token_set_root

    def insert_style_tokens(
        styles: List[Any],
        mode_descriptors: List[Dict[str, Any]],
        default_collection_name: str = "styles",
    ) -> None:
        for style in styles:
            if not isinstance(style, dict):
                continue
            style_name = style.get("name") or ""
            style_collection = str(style.get("collection") or default_collection_name).strip() or "styles"
            raw_style_type = str(style.get("styleType") or style.get("type") or style.get("resolvedType") or "").upper()
            for descriptor in mode_descriptors:
                mode_name = descriptor["name"]
                output_token_set_key = token_set_key(style_collection, mode_name)
                register_theme_token_set(mode_name, output_token_set_key)
                token_set_root = get_or_create_token_set(output_token_set_key)

                value = value_for_mode(style.get("valuesByMode"), descriptor)
                if value is None:
                    paints = value_for_mode(style.get("paintsByMode"), descriptor)
                    if isinstance(paints, list) and paints:
                        value = figma_paint_to_token_value(paints[0])
                    elif isinstance(paints, dict):
                        value = figma_paint_to_token_value(paints)
                if value is None and isinstance(style.get("paints"), list) and style["paints"]:
                    value = figma_paint_to_token_value(style["paints"][0])
                if value is None and isinstance(style.get("paint"), dict):
                    value = figma_paint_to_token_value(style["paint"])
                if value is None and raw_style_type in {"GRADIENT", "PAINT"}:
                    continue

                token_type = "gradient" if isinstance(value, dict) and "stops" in value else style.get("resolvedType") or style.get("type")
                token = ensure_token_dict(
                    value,
                    token_type,
                    str(style.get("description") or ""),
                )
                insert_token_path(token_set_root, style_name, token)

    for collection in collections:
        if not isinstance(collection, dict):
            continue
        collection_name = str(collection.get("name") or "").strip()
        if not collection_name:
            continue

        mode_descriptors = get_mode_descriptors(
            collection,
            "Base" if collection_name.lower() == "primitive" else "Light",
        )

        variables = collection.get("variables", [])
        if not isinstance(variables, list):
            variables = []
        collection_styles = collection.get("styles", [])
        if not isinstance(collection_styles, list):
            collection_styles = []

        if collection_name.lower() == "primitive":
            primitive_root = payload["primitive"]["primitive"]
            for variable in variables:
                if not isinstance(variable, dict):
                    continue
                token = ensure_token_dict(
                    variable.get("value"),
                    variable.get("resolvedType") or variable.get("type"),
                    str(variable.get("description") or ""),
                )
                insert_token_path(primitive_root, variable.get("name") or "", token)
            insert_style_tokens(collection_styles, mode_descriptors, "styles")
            continue

        for descriptor in mode_descriptors:
            mode_name = descriptor["name"]
            output_token_set_key = token_set_key(collection_name, mode_name)

            inserted_variable = False
            for variable in variables:
                if not isinstance(variable, dict):
                    continue
                value = value_for_mode(variable.get("valuesByMode"), descriptor)
                if value is None:
                    value = variable.get("value")
                if value is None:
                    continue
                if not inserted_variable:
                    register_theme_token_set(mode_name, output_token_set_key)
                    token_set_root = get_or_create_token_set(output_token_set_key)
                    inserted_variable = True
                token = ensure_token_dict(
                    value,
                    variable.get("resolvedType") or variable.get("type"),
                    str(variable.get("description") or ""),
                )
                insert_token_path(token_set_root, variable.get("name") or "", token)

        insert_style_tokens(collection_styles, mode_descriptors, "styles")

    if top_level_styles:
        fallback_modes = [{"name": theme_name, "id": normalize_theme_id(theme_name), "lookup_keys": [theme_name, normalize_theme_id(theme_name), theme_name.lower()]} for theme_name in theme_names] or get_mode_descriptors({}, "Light")
        insert_style_tokens(top_level_styles, fallback_modes, "styles")

    payload["$themes"] = [
        {
            "id": normalize_theme_id(theme_name),
            "name": title_case(theme_name),
            "selectedTokenSets": {
                **selected_by_theme.get(theme_name, {"primitive": "enabled"}),
                **{
                    token_set: (
                        "enabled"
                        if token_set in selected_by_theme.get(theme_name, {})
                        else "disabled"
                    )
                    for token_set in token_set_order[1:]
                },
            },
        }
        for theme_name in theme_names
    ]
    payload["$metadata"] = {"tokenSetOrder": token_set_order}
    refine_alias_types(payload)
    return payload


def detect_input_format(source_data: Dict[str, Any]) -> str:
    if "collections" in source_data and isinstance(source_data["collections"], list):
        return "figma-export"
    top_level_keys = [key for key in source_data.keys() if not key.startswith("$")]
    if any("/" in key for key in top_level_keys):
        return "ai-native"
    if get_primitive_source(source_data)[1]:
        return "token-studio-native"
    return "token-studio-native"


def build_payload(source_data: Dict[str, Any], input_format: str) -> Dict[str, Any]:
    resolved_input_format = detect_input_format(source_data) if input_format == "auto" else input_format
    if resolved_input_format == "ai-native":
        payload = copy.deepcopy(source_data)
        refine_alias_types(payload)
        return payload
    if resolved_input_format == "figma-export":
        return build_payload_from_figma_export(source_data)
    return build_payload_from_token_source(source_data)


def write_payloads(outputs: Tuple[str, ...], payload: Dict[str, Any]) -> None:
    for output_path in outputs:
        parent = os.path.dirname(output_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build an AI Native schema payload for adapted imports into the Figma plugin."
    )
    parser.add_argument("--source", required=True, help="Path to the canonical token source JSON.")
    parser.add_argument(
        "--input-format",
        choices=SUPPORTED_INPUT_FORMATS,
        default="auto",
        help="Source schema to adapt. Use auto to detect token-studio-native, figma-export, or ai-native.",
    )
    parser.add_argument(
        "--output",
        action="append",
        dest="outputs",
        required=True,
        help="Output path for the generated AI Native schema JSON. Pass multiple times to write duplicates.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    outputs = tuple(args.outputs)
    with open(args.source, "r", encoding="utf-8") as handle:
        source_data = json.load(handle)
    payload = build_payload(source_data, args.input_format)
    write_payloads(outputs, payload)
    print("Generated:")
    for output_path in outputs:
        print(f"- {output_path}")


if __name__ == "__main__":
    main()
