Plexus System CSV Headers & Import Templates

Based directly on the upload engine in server.js (/api/upload/:type), all incoming column headers are normalized by:

mapHeaders: ({ header }) => header.trim().toLowerCase()


They are matched either by exact key lookups or regular expressions.

1. EMR Master CSV (/api/upload/emr)

Used in the Data Center button: "EMR Master CSV" (upload('emr')).

Upserts into the patients collection in MongoDB.

Header Mapping Logic in server.js

Field

Mandatory

Regex / Key Checked in server.js

Recommended Header

Chart / MRN

YES

/chart|id|mrn/i (Skips row if missing)

chartNumber (or chart, mrn, id)

Patient Name

No

/patient|name/i

patientName (or name, patient)

Date of Birth

No

row['dob'] || row['date of birth'] || row['birth date']

dob

Gender / Sex

No

row['gender'] || row['sex']

gender (or sex)

Phone

No

row['phone'] || row['cell'] || row['tel']

phone

Email

No

row['email']

email

Insurance

No

row['insurance'] || row['primary payer'] || row['payer']

insurance

Age

No

row['age']

age

Recommended Standard Header Row

chartNumber,patientName,dob,gender,phone,email,insurance,age


Example emr_master.csv

chartNumber,patientName,dob,gender,phone,email,insurance,age
10024,John Doe,1980-04-15,Male,555-123-4567,johndoe@example.com,Blue Cross,46
10025,Jane Smith,1992-08-22,Female,555-987-6543,janesmith@example.com,Aetna,34


2. History Copy CSV (/api/upload/master)

Used in the Data Center button: "History Copy CSV" (upload('master')).

Appends into the procedureshistories collection in MongoDB.

Header Mapping Logic in server.js

Field

Mandatory

Regex / Key Checked in server.js

Recommended Header

Chart / MRN

YES

/chart|id|mrn/i (Skips row if missing)

chartNumber (or chart, mrn, id)

Procedure

YES

/procedure|test|svc|description/i (Skips row if missing)

procedure (or test, description)

Date of Service

YES

/date|service/i (Skips row if missing)

dateOfService (or date, service)

Patient Name

No

/patient|name/i (Defaults to 'Unknown Patient')

patientName (or name)

Recommended Standard Header Row

chartNumber,patientName,procedure,dateOfService


Example history.csv

chartNumber,patientName,procedure,dateOfService
10024,John Doe,BrainWave,2025-11-10
10024,John Doe,VitalWave,2026-01-15
10025,Jane Smith,Ultrasound,2026-03-02


3. Bonus: Create Schedule CSV (processScheduleCSV in index.html)

Used on the "Create Schedule" tab via the "Upload CSV" button.

Header Mapping Logic

Searches for a header row containing both:

An ID column: contains chart or id

A Time column: contains time or appt

Required headers:

Time

Chart Number (or Chart, ID)

Time,Chart Number
09:00 AM,10024
09:30 AM,10025
