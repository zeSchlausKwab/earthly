"""Replace only Earthly's marked map service block; leave other sites byte-for-byte intact."""
import re
import sys
from pathlib import Path

BEGIN = '# BEGIN earthly-map-plugin'
END = '# END earthly-map-plugin'


def merge(current: str, snippet: str) -> str:
    if not snippet.startswith(BEGIN + '\n') or not snippet.endswith(END + '\n'):
        raise ValueError('Invalid map service Caddy block')
    hostname = snippet.splitlines()[1].removesuffix(' {')
    if not re.fullmatch(r'[a-z0-9.-]+', hostname):
        raise ValueError('Invalid map service hostname')
    if current.count(BEGIN) != current.count(END) or current.count(BEGIN) > 1:
        raise ValueError('Ambiguous map service markers in existing Caddyfile')
    if BEGIN in current:
        start = current.index(BEGIN)
        end_start = current.index(END)
        end = end_start + len(END)
        if end_start < start:
            raise ValueError('Reversed map service markers')
        if current[end:end+1] == '\n':
            end += 1
        outside = current[:start] + current[end:]
        if re.search(r'(?<![\w.-])' + re.escape(hostname) + r'(?![\w.-])', outside):
            raise ValueError('Map service hostname already exists outside the managed block')
        return current[:start] + snippet + current[end:]
    if re.search(r'(?<![\w.-])' + re.escape(hostname) + r'(?![\w.-])', current):
        raise ValueError('Map service hostname already exists outside the managed block')
    return current + ('\n' if current.endswith('\n') else '\n\n') + snippet


if __name__ == '__main__':
    original, snippet, output = map(Path, sys.argv[1:])
    output.write_text(merge(original.read_text(), snippet.read_text()))
