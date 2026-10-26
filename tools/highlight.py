"""极小依赖的语法高亮：把源码切成 span.token-* 序列。

设计取舍：不追求 AST 级正确性，而是用「注释/字符串/数字/关键字/运算符」
的优先级扫描，覆盖工程博客常见语言，且保证 HTML 转义正确、输出稳定。
"""
from __future__ import annotations

import html
import re

# 语言别名归一
ALIASES = {
    "py": "python", "python3": "python",
    "c++": "cpp", "cc": "cpp", "cxx": "cpp", "hpp": "cpp", "h": "cpp",
    "js": "javascript", "jsx": "javascript", "mjs": "javascript", "cjs": "javascript",
    "ts": "typescript", "tsx": "typescript",
    "sh": "bash", "shell": "bash", "zsh": "bash", "console": "bash", "ps1": "powershell",
    "yml": "yaml", "rs": "rust", "golang": "go", "mlx": "matlab",
    "dockerfile": "docker", "docker": "docker", "make": "makefile", "mk": "makefile",
    "jsonc": "json", "htm": "html", "xml": "html", "svg": "html",
    "text": "plain", "txt": "plain", "": "plain", "none": "plain",
}

KEYWORDS = {
    "python": """False None True and as assert async await break class continue def del elif else
        except finally for from global if import in is lambda nonlocal not or pass raise return
        try while with yield match case self cls""",
    "cpp": """alignas alignof auto bool break case catch char class const constexpr continue
        decltype default delete do double else enum explicit export extern false float for friend
        goto if inline int long mutable namespace new noexcept nullptr operator private protected
        public register return short signed sizeof static static_cast struct switch template this
        throw true try typedef typename union unsigned using virtual void volatile while
        override final const_cast dynamic_cast reinterpret_cast consteval constinit concept requires
        co_await co_return co_yield char8_t char16_t char32_t wchar_t""",
    "rust": """as async await break const continue crate dyn else enum extern false fn for if impl
        in let loop match mod move mut pub ref return self Self static struct super trait true type
        unsafe use where while union macro_rules""",
    "javascript": """async await break case catch class const continue debugger default delete do
        else export extends finally for function if import in instanceof let new return static
        super switch this throw try typeof var void while with yield of get set""",
    "typescript": """abstract any as asserts async await bigint boolean break case catch class const
        constructor continue declare default delete do else enum export extends finally for from
        function get if implements import in infer instanceof interface is keyof let module
        namespace never new null number object of package private protected public readonly require
        return satisfies set static string super switch symbol this throw try type typeof undefined
        unique unknown var void while yield""",
    "go": """break case chan const continue default defer else fallthrough for func go goto if
        import interface map package range return select struct switch type var""",
    "bash": """if then else elif fi for while until do done case esac function in select time
        return break continue local export readonly declare unset shift trap set eval exec source""",
    "yaml": """true false null yes no on off""",
    "toml": """true false""",
    "json": """true false null""",
    "sql": """select from where group by order having limit offset insert into values update set
        delete create table index view join left right inner outer on as and or not null distinct
        count sum avg min max union all case when then else end primary key foreign references""",
    "matlab": """function end if elseif else switch case otherwise for while break continue return
        try catch global persistent classdef properties methods events enumeration parfor spmd""",
    "cmake": """if elseif else endif foreach endforeach while endwhile function endfunction macro
        endmacro set unset list include add_executable add_library target_link_libraries
        find_package project cmake_minimum_required option message return""",
    "docker": """FROM RUN CMD LABEL MAINTAINER EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR
        ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS""",
    "makefile": """ifeq ifneq ifdef ifndef else endif include export unexport define endef
        override vpath""",
    "plain": "",
}

# 函数/类型等次要视觉层级用的内建名
BUILTINS = {
    "python": """abs all any ascii bin bool bytearray bytes callable chr classmethod compile
        complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr
        globals hasattr hash help hex id input int isinstance issubclass iter len list locals map
        max memoryview min next object oct open ord pow print property range repr reversed round
        set setattr slice sorted staticmethod str sum super tuple type vars zip Exception""",
    "cpp": """std vector string map unordered_map set pair shared_ptr unique_ptr make_shared
        make_unique size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t
        printf scanf malloc free memcpy memset""",
    "rust": """Vec String Option Some None Result Ok Err Box Rc Arc RefCell HashMap HashSet
        println print format vec panic assert assert_eq derive""",
    "javascript": """console document window Math JSON Object Array String Number Boolean Promise
        Map Set Symbol Error RegExp Date require module exports process""",
}

# (正则, token 名)，按顺序尝试；具名组优先
RULES = {
    "python": [
        (r"(?P<comment>#[^\n]*)", "comment"),
        (r"(?P<string>'''[\s\S]*?'''|\"\"\"[\s\S]*?\"\"\")", "string"),
        (r"(?P<string>[rbfu]{0,2}'(?:\\.|[^'\\\n])*'|[rbfu]{0,2}\"(?:\\.|[^\"\\\n])*\")", "string"),
        (r"(?P<decorator>@[A-Za-z_][\w.]*)", "decorator"),
        (r"(?P<number>\b0[xXbBoO][0-9a-fA-F_]+\b|\b\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?[jJ]?\b)", "number"),
        (r"(?P<word>[A-Za-z_]\w*)", "word"),
        (r"(?P<operator>[-+*/%=<>!&|^~@]+)", "operator"),
        (r"(?P<punct>[\[\]{}(),.:;])", "punct"),
    ],
    "cpp": [
        (r"(?P<comment>//[^\n]*|/\*[\s\S]*?\*/)", "comment"),
        (r"(?P<preproc>^[ \t]*#[ \t]*\w+)", "preproc"),
        (r"(?P<string>R\"[^(]*\([\s\S]*?\)[^\"]*\"|'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\")", "string"),
        (r"(?P<number>\b0[xX][0-9a-fA-F']+\b|\b\d[\d']*\.?[\d']*(?:[eE][+-]?\d+)?[fFuUlL]*\b)", "number"),
        (r"(?P<word>[A-Za-z_]\w*)", "word"),
        (r"(?P<operator>[-+*/%=<>!&|^~?:]+)", "operator"),
        (r"(?P<punct>[\[\]{}(),;.])", "punct"),
    ],
    "rust": [
        (r"(?P<comment>//[^\n]*|/\*[\s\S]*?\*/)", "comment"),
        (r"(?P<attribute>#!?\[[^\]]*\])", "decorator"),
        (r"(?P<string>r#*\"[\s\S]*?\"#*|'(?:\\.|[^'\\\n])'|\"(?:\\.|[^\"\\\n])*\")", "string"),
        (r"(?P<number>\b0[xXbBoO][0-9a-fA-F_]+\b|\b\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?(?:f32|f64|u8|u16|u32|u64|usize|i8|i16|i32|i64|isize)?\b)", "number"),
        (r"(?P<macro>\b[a-z_]\w*!)", "macro"),
        (r"(?P<word>[A-Za-z_]\w*)", "word"),
        (r"(?P<operator>[-+*/%=<>!&|^~?:]+)", "operator"),
        (r"(?P<punct>[\[\]{}(),;.#])", "punct"),
    ],
    "javascript": [
        (r"(?P<comment>//[^\n]*|/\*[\s\S]*?\*/)", "comment"),
        (r"(?P<string>`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\")", "string"),
        (r"(?P<number>\b0[xXbBoO][0-9a-fA-F_]+\b|\b\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?n?\b)", "number"),
        (r"(?P<regex>/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+/[gimsuy]*)", "string"),
        (r"(?P<word>[A-Za-z_$][\w$]*)", "word"),
        (r"(?P<operator>[-+*/%=<>!&|^~?:]+)", "operator"),
        (r"(?P<punct>[\[\]{}(),;.])", "punct"),
    ],
    "bash": [
        (r"(?P<comment>#[^\n]*)", "comment"),
        (r"(?P<string><<[-~]?'?\w+'?|'(?:[^']*)'|\"(?:\\.|[^\"\\])*\")", "string"),
        (r"(?P<variable>\$\{[^}]*\}|\$[A-Za-z_]\w*|\$[?#@*!$0-9])", "variable"),
        (r"(?P<number>\b\d+\b)", "number"),
        (r"(?P<word>[A-Za-z_][\w-]*)", "word"),
        (r"(?P<operator>[-+*/%=<>!&|^~]+|&&|\|\|)", "operator"),
        (r"(?P<punct>[\[\]{}(),;])", "punct"),
    ],
    "yaml": [
        (r"(?P<comment>#[^\n]*)", "comment"),
        (r"(?P<key>^[ \t-]*[A-Za-z_][\w.\- ]*(?=:))", "key"),
        (r"(?P<string>'(?:[^']*)'|\"(?:\\.|[^\"\\])*\")", "string"),
        (r"(?P<number>\b\d[\d_]*\.?[\d_]*\b)", "number"),
        (r"(?P<word>[A-Za-z_][\w.\-]*)", "word"),
        (r"(?P<punct>[:\[\]{},|-])", "punct"),
    ],
    "json": [
        (r"(?P<key>\"(?:\\.|[^\"\\])*\"(?=\s*:))", "key"),
        (r"(?P<string>\"(?:\\.|[^\"\\])*\")", "string"),
        (r"(?P<number>-?\b\d+\.?\d*(?:[eE][+-]?\d+)?\b)", "number"),
        (r"(?P<word>[A-Za-z_]\w*)", "word"),
        (r"(?P<punct>[\[\]{},:])", "punct"),
    ],
    "matlab": [
        (r"(?P<comment>%[^\n]*)", "comment"),
        (r"(?P<string>'(?:[^'\n]|'')*')", "string"),
        (r"(?P<number>\b\d+\.?\d*(?:[eE][+-]?\d+)?\b)", "number"),
        (r"(?P<word>[A-Za-z_]\w*)", "word"),
        (r"(?P<operator>[-+*/\\^<>=~&|]+|\.\*|\./|\.\^)", "operator"),
        (r"(?P<punct>[\[\]{}(),;:])", "punct"),
    ],
    "docker": [
        (r"(?P<comment>#[^\n]*)", "comment"),
        (r"(?P<string>'(?:[^']*)'|\"(?:\\.|[^\"\\])*\")", "string"),
        (r"(?P<word>[A-Za-z_][\w-]*)", "word"),
        (r"(?P<punct>[=\\/:.])", "punct"),
    ],
    "makefile": [
        (r"(?P<comment>#[^\n]*)", "comment"),
        (r"(?P<variable>\$\([^)]*\)|\$\{[^}]*\})", "variable"),
        (r"(?P<target>^[A-Za-z_][\w./\- ]*(?=:))", "key"),
        (r"(?P<string>'(?:[^']*)'|\"(?:\\.|[^\"\\])*\")", "string"),
        (r"(?P<word>[A-Za-z_][\w.\-]*)", "word"),
        (r"(?P<punct>[:=])", "punct"),
    ],
    "html": [
        (r"(?P<comment><!--[\s\S]*?-->)", "comment"),
        (r"(?P<tag></?[A-Za-z][\w:-]*)", "keyword"),
        (r"(?P<attr>[A-Za-z_:][\w:.-]*(?==))", "key"),
        (r"(?P<string>\"(?:[^\"]*)\"|'(?:[^']*)')", "string"),
        (r"(?P<punct>[<>=/])", "punct"),
    ],
    "sql": [
        (r"(?P<comment>--[^\n]*|/\*[\s\S]*?\*/)", "comment"),
        (r"(?P<string>'(?:[^']|'')*')", "string"),
        (r"(?P<number>\b\d+\.?\d*\b)", "number"),
        (r"(?P<word>[A-Za-z_]\w*)", "word"),
        (r"(?P<punct>[(),;.*=<>+\-])", "punct"),
    ],
    "powershell": [
        (r"(?P<comment>#[^\n]*)", "comment"),
        (r"(?P<string>'(?:[^']|'')*'|\"(?:\\.|[^\"\\])*\")", "string"),
        (r"(?P<variable>\$[\w:]+)", "variable"),
        (r"(?P<number>\b\d+\.?\d*\b)", "number"),
        (r"(?P<word>[A-Za-z_][\w-]*)", "word"),
        (r"(?P<operator>[-+*/%=<>!&|]+)", "operator"),
        (r"(?P<punct>[\[\]{}(),;.])", "punct"),
    ],
}
# 复用别的语言的规则
for _alias, _src in (("typescript", "javascript"), ("toml", "yaml"), ("go", "cpp"),
                     ("cmake", "bash")):
    RULES.setdefault(_alias, RULES[_src])

COMPILED = {
    lang: [(re.compile(rx, re.MULTILINE), name) for rx, name in rules]
    for lang, rules in RULES.items()
}


def normalize(lang: str) -> str:
    lang = (lang or "").strip().lower()
    lang = ALIASES.get(lang, lang)
    return lang if lang in RULES else "plain"


def highlight(code: str, lang: str = "") -> str:
    """返回已转义的 HTML（span.token-<kind> 包裹），不带 <pre>。"""
    lang = normalize(lang)
    rules = COMPILED.get(lang)
    if not rules:
        return html.escape(code)

    kw = set(KEYWORDS.get(lang, "").split())
    bi = set(BUILTINS.get(lang, "").split())
    out: list[str] = []
    pos = 0
    n = len(code)

    while pos < n:
        best = None
        for rx, kind in rules:
            m = rx.match(code, pos)
            if m and (best is None or m.end() > best[0].end()):
                best = (m, kind)
        if best is None:
            out.append(html.escape(code[pos]))
            pos += 1
            continue

        m, kind = best
        text = m.group(0)
        cls = kind
        if kind == "word":
            if text in kw:
                cls = "keyword"
            elif text in bi:
                cls = "builtin"
            elif pos + len(text) < n and code[pos + len(text)] == "(":
                cls = "function"
            elif text[:1].isupper():
                cls = "type"
            else:
                cls = "plain"
        if cls == "plain":
            out.append(html.escape(text))
        else:
            out.append(f'<span class="tok-{cls}">{html.escape(text)}</span>')
        pos = m.end()

    return "".join(out)
