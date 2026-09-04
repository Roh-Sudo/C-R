# Scanner Validation

Run `npm run quality:benchmark` to execute the deterministic golden dataset. The report contains TP, FP, FN, TN, precision, recall, and F1 only for labeled cases. It is an internal engineering measurement, not universal real-repository accuracy. Run `compliance-check . --validation-mode --profile` for a local source-free validation summary and timing profile.

The current 11-case dataset is intentionally too small to certify production rule stability, so registry rules remain `BETA` until broader language, repository-context, and regression coverage is reviewed.