# Vendored format schemas

Used by `tests/schema-validation.test.ts` (via `xmllint`, package `libxml2-utils`) to
validate the kitchen-sink exports — the structural half of what Word's strict OOXML
reader enforces and LibreOffice silently forgives.

| Directory | Contents | Source |
|---|---|---|
| `ooxml/` | ECMA-376 5th ed. **Transitional** XSDs (wml, dml, vml, shared) | `ecma-international.org` → ECMA-376 Part 4, `OfficeOpenXML-XMLSchema-Transitional.zip` |
| `opc/` | OPC XSDs (content types, relationships, core properties) + Dublin Core + W3C `xml.xsd` | ECMA-376 Part 2 `OpenPackagingConventions-XMLSchema.zip`; `dublincore.org/schemas/xmls/qdc/2003/04/02/`; `w3.org/2001/03/xml.xsd` |
| `odf/` | OASIS **ODF 1.3** RelaxNG (document + manifest) | `docs.oasis-open.org/office/OpenDocument/v1.3/os/schemas/` |

Local patches, so validation runs offline (`xmllint --nonet`):

- `ooxml/wml.xsd`, `ooxml/shared-math.xsd`: the location-less
  `<xsd:import namespace="…XML/1998/namespace"/>` now names the vendored `xml.xsd`.
- `opc/opc-coreProperties.xsd`, `opc/dc.xsd`, `opc/dcterms.xsd`, `opc/dcmitype.xsd`:
  the absolute `dublincore.org` / `w3.org` schemaLocations now name the local copies.

The schemas are test assets only (nothing ships). OASIS/DC/W3C files carry their own
notices; the ECMA-376 schemas are distributed by Ecma International with its standards.
