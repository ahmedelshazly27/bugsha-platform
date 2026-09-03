#!/usr/bin/env python3
"""Turn a supabase/tests/*.sql pgTAP suite into a single query that collects
every assertion into tests.tap and then aborts the transaction with the TAP
output as the error text. Fixtures roll back; the results still come out.
Usage: scripts/pgtap-runner.py supabase/tests/06_redemption.sql | psql "$DATABASE_URL"
(or paste the output into the Supabase SQL editor / MCP execute_sql)."""
import re, sys, pathlib
FN = r"(plan|finish|is|isnt|ok|throws_ok|lives_ok|is_empty|isnt_empty)"
for f in sys.argv[1:]:
    s = pathlib.Path(f).read_text()
    s = re.sub(r"^begin;\s*", "delete from tests.tap;\n", s, flags=re.M)
    s = re.sub(r"select \* from finish\(\);\s*rollback;",
               "insert into tests.tap(line) select * from finish();\n"
               "do $x$ declare t text; begin select string_agg(line, E'\\n' order by seq) into t from tests.tap; raise exception E'TAP\\n%', t; end $x$;", s)
    s = re.sub(r"(^|;\s*)select " + FN + r"\(", lambda m: m.group(1) + "insert into tests.tap(line) select " + m.group(2) + "(", s, flags=re.M)
    sys.stdout.write(s + "\n")
