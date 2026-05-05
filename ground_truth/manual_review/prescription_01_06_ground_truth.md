# Prescription 01-06 Ground Truth

Source basis:
- Manual review of the source PDF page images generated from `/Users/yavar/Documents/CoE/Manipal/data/Prescription_01.pdf` through `Prescription_06.pdf`
- No dashboard rendering and no agent output was used as the final source of truth
- Older extracted JSON was used only as a cross-check where handwriting was hard to read

Main machine-readable file:
- [prescription_01_06_ground_truth.csv](/Users/yavar/Documents/CoE/Manipal/ground_truth/manual_review/prescription_01_06_ground_truth.csv)

## Summary Table

| File | Patient | Visit Date | Dept | Key clinical content | Orders / meds |
| --- | --- | --- | --- | --- | --- |
| `Prescription_01.pdf` | MRS NAZNEEN JAMAL, 71/F | 2026-03-24 13:02 | ENT MHB | Fever x2 days, unilateral right-sided headache x2 days, occasional right-sided tinnitus, bilateral mild sloping SNHL | Pure tone audiogram; Dolo 650 mg SOS for fever |
| `Prescription_02.pdf` | MR RAMESH G JETHWANI, 77/M | 2026-04-17 16:15 | Dermatology MHB | Treatment continuation sheet; no explicit diagnosis on page | AF 150 twice weekly (Sat + Wed) for 4 weeks |
| `Prescription_03.pdf` | MRS HELEN MARTIS, 77/F | 2026-04-14 12:38 | Urology MHB | Nocturia x5 years, urgency, UTI, SUI, CKD x3 years, meatal stenosis | Mirabeg 25 mg nightly x40 days; urine culture; ultrasound abdomen & pelvis; uroflowmetry + PVR |
| `Prescription_04.pdf` | MR NARAYANASWAMY S, 59/M | 2026-04-10 12:18 | Neurology MHB | Numbness in right little and ring fingers since yesterday afternoon; sensory impairment in right little finger | NCS both ULs, ulnar below and above elbow |
| `Prescription_05.pdf` | MRS LATHA MANGESHKAR, 54/F | 2026-02-12 11:44 | Obstetrics and Gynaecology MHS | HMB for past 2 days; known-case shorthand present but partly unclear | Review/return note for 27/02/2026; plan line not fully legible |
| `Prescription_06.pdf` | MR SANTHILAL, 65/M | 2026-04-17 13:51 | Urology MHS | Patient review; PSA review | PSA note only; no medication written clearly |

## Detailed Table

| File | Identifiers | Doctor | Vitals | Complaints / assessment | Investigations / procedures | Medications / follow-up | Review notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Prescription_01.pdf` | Hospital No `MH000001285`; Episode No `O00011800756`; Mobile `9448460565` | DR. E.V. RAMAN; `14750`; D.L.O-79, M.S-1979, FICS-92 | No source-backed vitals written | Fever since 2 days; headache since 2 days, unilateral right-sided; occasional right-sided tinnitus; bilateral mild sloping SNHL; bilateral TM okay; no complaint of hearing loss/giddiness; no complaint of nasal stuffiness/discharge; no complaint of sore throat/cough | Pure tone audiogram checked | T. Dolo 650 mg SOS for fever; cross-reference: visit Dr. Ravi Raghavan if fever does not subside | Diagram-side ENT annotations are partly handwritten; a possible DNS-right note is legible but remains handwriting-based |
| `Prescription_02.pdf` | Hospital No `MH000001195`; Episode No `O00011860488` | DR. RADHAKRISHNA BHAT; `49915`; MBBS-98, MD-2002 | No source-backed vitals written | Prescription / continuation note only; no explicit diagnosis written | None | Tab AF 150 twice weekly `(Sat + Wed)` for 4 weeks; all other treatment to be followed as advised earlier today | Small left-side note is not fully legible and was excluded |
| `Prescription_03.pdf` | Hospital No `MH000003683`; Episode No `O00011853288`; Mobile `9845220616`; Email `melissa.martis@gmail.com` | DR SURYAKANT CHOUBEY; `92410`; M.B.B.S, M.S. (General Surgery), M.Ch. (Urology), D.N.B. (Urology), M.N.A.M.S (Urology) | No source-backed vitals written | Nocturia x5 years; urgency; UTI; SUI; CKD x3 years; meatal stenosis; urine routine note with protein `2+`, glucose `+`, pus cells `2-5`; HbA1c `7`; serum creatinine `1.78`; uric acid `9.6`; hemoglobin `14.5`; DM and HTN boxes checked; angioplasty noted in 2024 | Urine culture circled; ultrasound abdomen & pelvis circled; uroflowmetry checked; handwritten `PVR` | T MIRABEG 25 mg `0-0-1` for 40 days | Angioplasty history was preserved as written instead of inferring a diagnosis such as CAD |
| `Prescription_04.pdf` | Hospital No `MH000004664`; Episode No `O00011843893`; Mobile `9916573142`; Email `nswamys.s46@gmail.com` | DR. UDAY A MURGOD; `31769`; MD, DM (Neurology) | BP `160/100` | Numbness in right little and ring fingers since yesterday afternoon; no weakness; no pain; no wasting; sensory impairment in right little finger; DTR normal; note states no HTN / no DM | NCS both ULs, ulnar below and above elbow too | None | No explicit diagnosis line is written on the page |
| `Prescription_05.pdf` | Hospital No `MH010002667`; Episode No `O06000392333`; Mobile `9042716111` | DR SUBHASINI M; `74819`; MBBS, MD, (O.G), DRM (Keil, Germany) | Temp `97.9 F`; BMI `29.7`; pain `1/10`; SpO2 `99%`; height `161 cm`; weight `77 kg`; BP `130/80`; pulse `90/min`; allergies `nil` | C/o HMB for past 2 days; one shorthand history line appears to read known-case notation | None clearly written | Review/return note for `27/02/2026`; no clearly legible medicine name on the plan line | The history shorthand and the plan/medication line are only partly legible |
| `Prescription_06.pdf` | Hospital No `MH010001836`; Episode No `O06000405112`; Mobile `9443362815` | DR RAJASEKAR M; `61954` | Weight `80 kg`; height `168 cm`; BP `120/80`; pulse `70/min`; temp `97.6 F`; allergies `nil`; SpO2 `99%`; pain `2/10` | Pt review; PSA review | PSA note only | None | The mark after `PSA` looks like a handwritten normal/okay indicator, but the GT keeps it as a review note rather than asserting a formal result |
