# Prescription UI vs GT Evaluation

Executed: 2026-05-03T10:43:54.041Z

## Summary

| File | Status | Matched | Total | Pass % | UI issues |
| --- | --- | ---: | ---: | ---: | ---: |
| Prescription_01.pdf | processed | 15 | 23 | 65.2% | 3 |
| Prescription_02.pdf | processed | 12 | 15 | 80% | 2 |
| Prescription_03.pdf | processed | 19 | 29 | 65.5% | 4 |
| Prescription_04.pdf | processed | 14 | 19 | 73.7% | 1 |
| Prescription_05.pdf | processed | 14 | 20 | 70% | 0 |
| Prescription_06.pdf | processed | 14 | 20 | 70% | 1 |

Overall: 88/126 matched (69.8%).

## Prescription_01.pdf

- Document ID: `8ddc04a4-f258-4873-b813-884d7f41297e`
- Status: `processed`
- Score: 15/23 (65.2%)
- UI issues:
  - Dashboard shows zero-placeholder vitals even though GT has no documented vitals.
  - Dashboard shows inpatient header framing for an outpatient prescription.
  - Dashboard treatment/procedure presentation is likely incomplete versus GT procedure orders.
- Misses:
  - episode_no: expected "O00011800756"
  - department: expected "ENT MHB"
  - finding:bilateral TM okay: expected "bilateral TM okay"
  - finding:no complaint of hearing loss/giddiness: expected "no complaint of hearing loss/giddiness"
  - finding:no complaint of nasal stuffiness/discharge: expected "no complaint of nasal stuffiness/discharge"
  - finding:no complaint of sore throat/cough: expected "no complaint of sore throat/cough"
  - history:Possible DNS to right noted in diagram annotation: expected "Possible DNS to right noted in diagram annotation"
  - medication:T. Dolo 650 mg: expected "T. Dolo 650 mg"

## Prescription_02.pdf

- Document ID: `09a13ca6-017e-4ff9-bbd8-4bc508ccd0bb`
- Status: `processed`
- Score: 12/15 (80%)
- UI issues:
  - Dashboard shows zero-placeholder vitals even though GT has no documented vitals.
  - Dashboard shows inpatient header framing for an outpatient prescription.
- Misses:
  - episode_no: expected "O00011860488"
  - department: expected "DERMATOLOGY MHB"
  - complaint:Prescription / treatment continuation visit: expected "Prescription / treatment continuation visit"

## Prescription_03.pdf

- Document ID: `b01134e9-8252-4a61-a580-10e598725cae`
- Status: `processed`
- Score: 19/29 (65.5%)
- UI issues:
  - Dashboard shows zero-placeholder vitals even though GT has no documented vitals.
  - Dashboard shows inpatient header framing for an outpatient prescription.
  - Dashboard shows no labs even though GT contains lab investigations.
  - Dashboard treatment/procedure presentation is likely incomplete versus GT procedure orders.
- Misses:
  - episode_no: expected "O00011853288"
  - department: expected "UROLOGY MHB"
  - complaint:SUI: expected "SUI"
  - finding:urine routine note shows protein 2+, glucose +, pus cells 2-5: expected "urine routine note shows protein 2+, glucose +, pus cells 2-5"
  - finding:HbA1c 7: expected "HbA1c 7"
  - finding:serum creatinine 1.78: expected "serum creatinine 1.78"
  - finding:uric acid 9.6: expected "uric acid 9.6"
  - finding:hemoglobin 14.5: expected "hemoglobin 14.5"
  - history:angioplasty noted in 2024: expected "angioplasty noted in 2024"
  - medication:T MIRABEG 25 mg: expected "T MIRABEG 25 mg"

## Prescription_04.pdf

- Document ID: `1651dd17-46f7-4103-8713-a1c8bada7769`
- Status: `processed`
- Score: 14/19 (73.7%)
- UI issues:
  - Dashboard treatment/procedure presentation is likely incomplete versus GT procedure orders.
- Misses:
  - hospital_no: expected "MH000004664"
  - department: expected "NEUROLOGY MHB"
  - finding:no wasting: expected "no wasting"
  - history:No HTN: expected "No HTN"
  - history:no DM: expected "no DM"

## Prescription_05.pdf

- Document ID: `57ec724e-2afd-4619-a591-8043d786e99d`
- Status: `processed`
- Score: 14/20 (70%)
- Misses:
  - hospital_no: expected "MH010002667"
  - department: expected "OBSTETRICS AND GYNAECOLOGY MHS"
  - height: expected "161"
  - pain_score: expected "1/10"
  - finding:one history note reads as known-case shorthand: expected "one history note reads as known-case shorthand"
  - history:History line appears to read k/c/o CHT, but the middle letters are handwritten and should be treated as uncertain: expected "History line appears to read k/c/o CHT, but the middle letters are handwritten and should be treated as uncertain"

## Prescription_06.pdf

- Document ID: `fddf30a9-ef7b-407d-8098-eaf9b8243963`
- Status: `processed`
- Score: 14/20 (70%)
- UI issues:
  - Dashboard shows no labs even though GT contains lab investigations.
- Misses:
  - episode_no: expected "O06000405112"
  - department: expected "UROLOGY MHS"
  - height: expected "168"
  - pain_score: expected "2/10"
  - complaint:Pt review: expected "Pt review"
  - finding:PSA note appears marked as normal/okay, but the trailing annotation is handwritten: expected "PSA note appears marked as normal/okay, but the trailing annotation is handwritten"

