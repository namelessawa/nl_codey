"""Per-language structural extractors for query derivation.

Each `extract_<feature>(content)` returns a list of records the family
builders can turn into (query, target) pairs. We aim for:

  - Python: stdlib `ast` — full structural extraction (definitive).
  - TypeScript/JavaScript: regex + lightweight balancing — heuristic but
    deterministic. Good enough for IR labels at scale; we filter
    ambiguous cases at the family-builder layer.
  - Go: regex for `func`, `import`, `// comment` blocks above funcs.

No third-party deps. Every extractor is pure (str → list[dict]).
"""
from __future__ import annotations

import ast
import re
from dataclasses import dataclass


# ----------------------------------------------------------------------
# Records returned by the extractors. Family builders consume these.
# ----------------------------------------------------------------------

@dataclass(frozen=True)
class Defn:
    """A top-level definition (function, class, method)."""
    kind: str           # "function" | "class" | "method" | "const"
    name: str           # bare identifier
    line: int           # 1-based line
    docstring: str      # "" if absent
    exported: bool      # True if exported / public (best effort)


@dataclass(frozen=True)
class Import:
    """An import statement → its resolved module string."""
    specifier: str      # what was imported (raw)
    module: str         # "from X import Y" → X; "import X" → X
    line: int


@dataclass(frozen=True)
class TestCase:
    """A test function or `it`-style description."""
    description: str    # human-language label (raw)
    function_name: str  # "test_foo" or "" if anonymous
    line: int


@dataclass(frozen=True)
class CallSite:
    """A call expression of the form `IDENT(...)`."""
    callee: str         # bare identifier (most-derived)
    full_text: str      # the full call expression, truncated
    line: int


# ----------------------------------------------------------------------
# Python — stdlib `ast`. Cleanest path.
# ----------------------------------------------------------------------

def extract_python(content: str) -> dict[str, list]:
    try:
        tree = ast.parse(content)
    except SyntaxError:
        return {"defns": [], "imports": [], "tests": [], "calls": []}

    defns: list[Defn] = []
    imports: list[Import] = []
    tests: list[TestCase] = []
    calls: list[CallSite] = []

    # Helper: extract docstring of a node.
    def _doc(node: ast.AST) -> str:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef,
                             ast.ClassDef, ast.Module)):
            doc = ast.get_docstring(node, clean=True) or ""
            # Take the first paragraph (up to a blank line) to avoid huge
            # multi-section docstrings.
            return doc.split("\n\n", 1)[0].strip()
        return ""

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            exported = not node.name.startswith("_")
            defns.append(Defn(
                kind="function",
                name=node.name,
                line=node.lineno,
                docstring=_doc(node),
                exported=exported,
            ))
            if node.name.startswith("test_"):
                tests.append(TestCase(
                    description=node.name.replace("test_", "").replace("_", " "),
                    function_name=node.name,
                    line=node.lineno,
                ))
        elif isinstance(node, ast.ClassDef):
            defns.append(Defn(
                kind="class",
                name=node.name,
                line=node.lineno,
                docstring=_doc(node),
                exported=not node.name.startswith("_"),
            ))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(Import(
                    specifier=alias.asname or alias.name,
                    module=alias.name,
                    line=node.lineno,
                ))
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            for alias in node.names:
                imports.append(Import(
                    specifier=alias.asname or alias.name,
                    module=mod,
                    line=node.lineno,
                ))
        elif isinstance(node, ast.Call):
            callee = _flatten_callee(node.func)
            if callee:
                try:
                    src = ast.unparse(node)
                    src = src[:200]
                except Exception:
                    src = callee + "(...)"
                calls.append(CallSite(
                    callee=callee,
                    full_text=src,
                    line=getattr(node, "lineno", 0),
                ))
    return {"defns": defns, "imports": imports, "tests": tests, "calls": calls}


def _flatten_callee(node: ast.AST) -> str:
    """Extract the most-derived identifier name from a call's func node."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return ""


# ----------------------------------------------------------------------
# TypeScript / JavaScript — heuristic regex extractors.
# ----------------------------------------------------------------------

# Match `export function name(` / `export async function name(` / `export class Name {`
# and the const-export forms.
_TS_EXPORTED_FUNC = re.compile(
    r"^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[<(]",
    re.MULTILINE,
)
_TS_EXPORTED_CLASS = re.compile(
    r"^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\s*[<{(]",
    re.MULTILINE,
)
_TS_EXPORTED_CONST = re.compile(
    r"^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]",
    re.MULTILINE,
)
_TS_DECL_FUNC = re.compile(
    r"^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[<(]",
    re.MULTILINE,
)
_TS_DECL_CLASS = re.compile(
    r"^\s*class\s+([A-Za-z_$][\w$]*)\s*[<{(]",
    re.MULTILINE,
)

# Match a JSDoc block /** ... */ followed (within 3 lines, possibly export)
# by the declaration whose name we extract.
_TS_JSDOC_BEFORE_DECL = re.compile(
    r"/\*\*\s*(?P<body>.*?)\s*\*/\s*"
    r"(?:export\s+)?(?:async\s+)?(?:function|const|class|let|var)\s+"
    r"(?P<name>[A-Za-z_$][\w$]*)",
    re.DOTALL,
)

# import { x } from "path"; import x from "path"; import * as x from "path"
_TS_IMPORT = re.compile(
    r"""^\s*import\s+
        (?:
            (?P<def>[A-Za-z_$][\w$]*)\s*,?\s*  # default import
        )?
        (?:
            \{\s*(?P<named>[^}]+)\s*\}\s*  # named imports
        )?
        (?:
            \*\s+as\s+(?P<star>[A-Za-z_$][\w$]*)\s*  # namespace import
        )?
        from\s+["'](?P<mod>[^"']+)["']
    """,
    re.MULTILINE | re.VERBOSE,
)

# describe("..."), it("..."), test("...") — Vitest/Jest pattern.
_TS_TEST_CALL = re.compile(
    r"""\b(describe|it|test)\s*\(\s*
        (?P<q>['"`])(?P<label>.+?)(?P=q)""",
    re.VERBOSE | re.DOTALL,
)

# Most-derived call expression: IDENT followed by `(`. Doesn't try to
# fully parse arguments; we just record up to the first closing paren
# at the same depth or 120 chars.
_TS_CALL = re.compile(
    r"\b([A-Za-z_$][\w$]*)\s*\(",
)


def extract_typescript(content: str) -> dict[str, list]:
    defns: list[Defn] = []
    imports: list[Import] = []
    tests: list[TestCase] = []
    calls: list[CallSite] = []
    line_of = _LineMapper(content)

    # JSDoc → docstring map (name → first paragraph).
    docmap: dict[str, str] = {}
    for m in _TS_JSDOC_BEFORE_DECL.finditer(content):
        name = m.group("name")
        body = m.group("body")
        doc = _clean_jsdoc(body)
        # Keep the first 1–3 sentences only.
        para = doc.split("\n\n", 1)[0].strip()
        if name and para and name not in docmap:
            docmap[name] = para

    seen_names: set[str] = set()
    for rx, kind, exported in (
        (_TS_EXPORTED_FUNC, "function", True),
        (_TS_EXPORTED_CLASS, "class", True),
        (_TS_EXPORTED_CONST, "const", True),
        (_TS_DECL_FUNC, "function", False),
        (_TS_DECL_CLASS, "class", False),
    ):
        for m in rx.finditer(content):
            name = m.group(1)
            if name in seen_names:
                continue
            seen_names.add(name)
            defns.append(Defn(
                kind=kind,
                name=name,
                line=line_of(m.start()),
                docstring=docmap.get(name, ""),
                exported=exported,
            ))

    for m in _TS_IMPORT.finditer(content):
        mod = m.group("mod")
        line = line_of(m.start())
        for raw in (m.group("def"), m.group("star")):
            if raw:
                imports.append(Import(specifier=raw, module=mod, line=line))
        named = m.group("named") or ""
        for piece in named.split(","):
            spec = piece.strip().split(" as ")[0].strip()
            if spec:
                imports.append(Import(specifier=spec, module=mod, line=line))

    for m in _TS_TEST_CALL.finditer(content):
        label = m.group("label").strip()
        if label:
            tests.append(TestCase(
                description=label[:200],
                function_name="",
                line=line_of(m.start()),
            ))

    # Calls: collect, but cap at 2k per file to avoid blowing memory on
    # generated code.
    for i, m in enumerate(_TS_CALL.finditer(content)):
        if i >= 2000:
            break
        callee = m.group(1)
        if callee in _TS_RESERVED:
            continue
        start = m.start()
        # Greedy small window to record up to 200 chars after the IDENT.
        snippet = content[start:start + 200].split("\n", 1)[0]
        calls.append(CallSite(
            callee=callee,
            full_text=snippet.strip(),
            line=line_of(start),
        ))

    return {"defns": defns, "imports": imports, "tests": tests, "calls": calls}


_TS_RESERVED = frozenset({
    "if", "for", "while", "switch", "catch", "return", "throw",
    "typeof", "new", "await", "async", "function", "import", "export",
    "from", "in", "of", "do", "else", "case", "break", "continue",
    "yield", "delete", "void", "instanceof",
})


def _clean_jsdoc(body: str) -> str:
    lines = []
    for raw in body.splitlines():
        s = raw.strip()
        s = s.lstrip("*").strip()
        # Drop tag lines like @param, @returns.
        if s.startswith("@"):
            continue
        lines.append(s)
    return "\n".join(lines).strip()


# ----------------------------------------------------------------------
# Go — very light regex extractors.
# ----------------------------------------------------------------------

_GO_FUNC = re.compile(
    r"^\s*func(?:\s+\([^)]*\))?\s+([A-Z][\w]*)\s*\(",
    re.MULTILINE,
)
# Identifier-call expressions. We require a leading non-identifier char so
# we don't catch the function NAME at definition sites (which match `_GO_FUNC`).
_GO_CALL = re.compile(
    r"(?<![A-Za-z_0-9])([A-Z]\w{2,})\s*\(",
)
_GO_IMPORT_SINGLE = re.compile(r'^\s*import\s+"([^"]+)"', re.MULTILINE)
_GO_IMPORT_BLOCK = re.compile(r'^\s*import\s*\(\s*([^)]*)\)', re.MULTILINE)
_GO_TEST = re.compile(
    r"^\s*func\s+(Test[A-Z]\w*)\s*\(\s*t\s+\*testing\.T",
    re.MULTILINE,
)
_GO_DOC = re.compile(
    r"((?:^//[^\n]*\n)+)\s*func(?:\s+\([^)]*\))?\s+([A-Z]\w*)\s*\(",
    re.MULTILINE,
)


def extract_go(content: str) -> dict[str, list]:
    defns: list[Defn] = []
    imports: list[Import] = []
    tests: list[TestCase] = []
    calls: list[CallSite] = []
    line_of = _LineMapper(content)

    docmap: dict[str, str] = {}
    for m in _GO_DOC.finditer(content):
        doc_block = m.group(1)
        name = m.group(2)
        # Strip leading `// ` from each comment line.
        cleaned = "\n".join(
            ln.lstrip("/ ").rstrip()
            for ln in doc_block.strip().splitlines()
        ).strip()
        if cleaned and name not in docmap:
            docmap[name] = cleaned.split("\n\n", 1)[0].strip()

    for m in _GO_FUNC.finditer(content):
        name = m.group(1)
        defns.append(Defn(
            kind="function",
            name=name,
            line=line_of(m.start()),
            docstring=docmap.get(name, ""),
            exported=True,
        ))

    for m in _GO_IMPORT_SINGLE.finditer(content):
        path = m.group(1)
        imports.append(Import(specifier=path.split("/")[-1], module=path,
                              line=line_of(m.start())))
    for m in _GO_IMPORT_BLOCK.finditer(content):
        line0 = line_of(m.start())
        for raw in m.group(1).splitlines():
            mm = re.search(r'"([^"]+)"', raw)
            if mm:
                imports.append(Import(
                    specifier=mm.group(1).split("/")[-1],
                    module=mm.group(1),
                    line=line0,
                ))

    for m in _GO_TEST.finditer(content):
        name = m.group(1)
        # Drop the leading "Test" and split CamelCase to spaces for the description.
        desc = re.sub(r"(?<!^)(?=[A-Z])", " ", name[4:]).strip()
        tests.append(TestCase(
            description=desc,
            function_name=name,
            line=line_of(m.start()),
        ))

    # Calls: bounded so generated Go (mock files etc.) can't blow memory.
    for i, m in enumerate(_GO_CALL.finditer(content)):
        if i >= 2000:
            break
        callee = m.group(1)
        if callee in _GO_RESERVED:
            continue
        start = m.start()
        snippet = content[start:start + 200].split("\n", 1)[0]
        calls.append(CallSite(
            callee=callee,
            full_text=snippet.strip(),
            line=line_of(start),
        ))

    return {"defns": defns, "imports": imports, "tests": tests, "calls": calls}


_GO_RESERVED = frozenset({
    "If", "For", "Switch", "Return", "Map", "Type", "Func", "Make", "New",
    "Println", "Printf", "Sprintf", "Errorf", "Fatal", "Fatalf",
})


# ----------------------------------------------------------------------
# Line lookup helper (offset → 1-based line number).
# ----------------------------------------------------------------------

class _LineMapper:
    """Cache newline offsets so offset-to-line is O(log n) per query."""

    def __init__(self, content: str) -> None:
        # offsets[i] is the byte just after the i-th newline.
        self._offsets = [0]
        for i, ch in enumerate(content):
            if ch == "\n":
                self._offsets.append(i + 1)

    def __call__(self, offset: int) -> int:
        import bisect
        return max(1, bisect.bisect_right(self._offsets, offset))


# ----------------------------------------------------------------------
# Dispatch.
# ----------------------------------------------------------------------

EXTRACTORS = {
    "python":     extract_python,
    "typescript": extract_typescript,
    "javascript": extract_typescript,  # same heuristics
    "go":         extract_go,
}


def extract(language: str, content: str) -> dict[str, list]:
    fn = EXTRACTORS.get(language)
    if fn is None:
        return {"defns": [], "imports": [], "tests": [], "calls": []}
    return fn(content)
