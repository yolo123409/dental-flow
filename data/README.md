# data/

Local-only import source data. Nothing in this directory is read at
application runtime - it exists solely as input to admin scripts in
`scripts/`, and none of it is tracked in git (see `.gitignore`).

## icd10cm_codes_2026.txt

CMS's official ICD-10-CM "Code Descriptions in Tabular Order" flat file
(FY2026 / April 1, 2026 update). Public domain.

- Format: fixed-width text, one code per line. Bytes 1-8 are the code
  (left-justified, padded with trailing spaces to 8 characters, no
  decimal point - CMS's billing/X12 form, e.g. `K0251`); byte 9 onward
  is the short description.
- 74,719 records, no duplicates, no malformed lines, no empty
  descriptions (verified at import time).

To reproduce this import on another machine, place the same CMS release
file at this exact path and run:

```
npm run import:icd10cm
```

See `scripts/import-icd10cm.js` for the full import logic, including the
decision to store codes in conventional dotted display form (`K02.9`
rather than `K0251`) to match this app's search/display behavior.
