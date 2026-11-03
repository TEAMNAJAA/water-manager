import sys
from pathlib import Path

ROOTS = ["ISRG_Root_X1", "ISRG_Root_X2", "GTS_Root_R1", "GTS_Root_R4", "Amazon_Root_CA_1", "DigiCert_Global_Root_G2", "USERTrust_RSA_Certification_Authority"]
STORE = Path(sys.argv[1] if len(sys.argv) > 1 else "/usr/share/ca-certificates/mozilla")
OUT = Path(__file__).resolve().parents[1] / "src" / "certs.h"

pem = "".join((STORE / f"{name}.crt").read_text().strip() + "\n" for name in ROOTS)
OUT.write_text(f'#pragma once\n\n// {", ".join(ROOTS)}\nstatic const char ROOT_CAS[] = R"PEM(\n{pem})PEM";\n')
print(f"wrote {OUT} with {len(ROOTS)} roots")
