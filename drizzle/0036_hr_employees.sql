-- HR Intelligence: the employee master and what hangs off it. Employee ID is the company's own code (DBYA0001),
-- from the HR employee list; it replaces the analytics Salesperson ID (EMP-0001) wherever a person is shown.
-- Seeded with the 91 people on "Employee List with Emp Id.xlsx" (16 Nov 2026): ID, name, email, department and
-- designation. Everything else is left empty for HR to fill in.

CREATE TABLE IF NOT EXISTS employees (
  employee_code text PRIMARY KEY CHECK (employee_code ~ '^[A-Z]{2,6}[0-9]{2,6}$'),
  full_name text NOT NULL,
  date_of_birth date,
  contact_no text,
  email text,
  -- Employment
  company text,
  store_code text,
  department text,
  designation text,
  -- Joining
  joining_date date,
  employment_type text CHECK (employment_type IN ('Full-time', 'Part-time', 'Contract', 'Intern', 'Weekend staff')),
  reporting_manager text REFERENCES employees(employee_code) ON UPDATE CASCADE ON DELETE SET NULL,
  -- Compensation
  monthly_ctc numeric(12, 2) CHECK (monthly_ctc >= 0),
  salary_structure jsonb NOT NULL DEFAULT '{}'::jsonb,
  incentive_eligible boolean,
  -- Documents (bank details and ID proof; files are listed in employee_documents)
  bank_name text,
  bank_account_holder text,
  bank_account_no text,
  bank_ifsc text,
  id_proof_type text,
  id_proof_number text,
  -- Status
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'On leave', 'Resigned', 'Exited')),
  status_since date,
  exit_date date,
  exit_reason text,
  -- Personal
  emergency_contact_name text,
  emergency_contact_relation text,
  emergency_contact_no text,
  blood_group text CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  notes text,
  -- The analytics salesperson (analytics.dim_salesperson.emp_code) this employee sells as. 'auto': matched by name;
  -- 'manual': picked by HR; 'none': HR said this employee is no salesperson, so auto-matching leaves them alone.
  salesperson_key text UNIQUE,
  salesperson_link text CHECK (salesperson_link IN ('auto', 'manual', 'none')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employees_department_idx ON employees (department);
CREATE INDEX IF NOT EXISTS employees_status_idx ON employees (status);

CREATE TABLE IF NOT EXISTS employee_family (
  id serial PRIMARY KEY,
  employee_code text NOT NULL REFERENCES employees(employee_code) ON UPDATE CASCADE ON DELETE CASCADE,
  name text NOT NULL,
  relation text NOT NULL,
  date_of_birth date,
  contact_no text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_family_employee_idx ON employee_family (employee_code);

-- Transfers, promotions and increments, newest first on the employee page.
CREATE TABLE IF NOT EXISTS employee_history (
  id serial PRIMARY KEY,
  employee_code text NOT NULL REFERENCES employees(employee_code) ON UPDATE CASCADE ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('Transfer', 'Promotion', 'Increment', 'Other')),
  effective_on date NOT NULL,
  from_value text,
  to_value text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_history_employee_idx ON employee_history (employee_code, effective_on DESC);

-- Appointment letter, ID proof, bank proof: a link to where the file is kept.
CREATE TABLE IF NOT EXISTS employee_documents (
  id serial PRIMARY KEY,
  employee_code text NOT NULL REFERENCES employees(employee_code) ON UPDATE CASCADE ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('Appointment letter', 'ID proof', 'Bank details', 'Other')),
  title text,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_documents_employee_idx ON employee_documents (employee_code);

-- One row per employee and day, from the biometric device once it is connected (source 'biometric') or typed in.
CREATE TABLE IF NOT EXISTS attendance_days (
  employee_code text NOT NULL REFERENCES employees(employee_code) ON UPDATE CASCADE ON DELETE CASCADE,
  day date NOT NULL,
  status text NOT NULL CHECK (status IN ('Present', 'Absent', 'Half day', 'Leave', 'Week off', 'Holiday')),
  in_at timestamptz,
  out_at timestamptz,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('biometric', 'manual')),
  device text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_code, day)
);
CREATE INDEX IF NOT EXISTS attendance_days_day_idx ON attendance_days (day);

INSERT INTO employees (employee_code, full_name, email, department, designation) VALUES
  ('DBYA0035', 'AMRUTHA C', 'dbya0035.deepam@gmail.com', 'E-commerce', 'Intern'),
  ('DBYA0039', 'JEEVANRAJ KUMAR', 'dbya0039.deepam@gmail.com', 'E-commerce', 'E-Commerce Executive'),
  ('DBYA0005', 'ARYAN CHATURVEDI', 'aryan@deepam.com', 'E-commerce', 'Head of Ecommerce Operations'),
  ('DBYA0009', 'SANDYA K A', 'dbya0009.deepam@gmail.com', 'E-commerce', 'Catalogue & Merchandising Manager'),
  ('DBYA0034', 'CHARITA REDDY', 'dbya0034.deepam@gmail.com', 'E-commerce', 'Intern'),
  ('DBYA0031', 'Devaraj S', 'devaraj@deepam.com', 'Finance & Accounts', 'Cashier'),
  ('DBYA0028', 'Chetana M V', 'chethana@deepam.com', 'Finance & Accounts', 'Accounts Executive'),
  ('DBYA0003', 'Vijaya Ananth', 'finance@deepam.com', 'Finance & Accounts', 'Head of Accounts & Finance'),
  ('DBYA0032', 'Suresh M', 'dbya0032.deepam@gmail.com', 'Finance & Accounts', 'Cashier'),
  ('DBYA0040', 'SUSHMA', 'dbya0040.deepam@gmail.com', 'Finance & Accounts', 'Junior Billing Executive'),
  ('DBYA0002', 'Neena D', 'neena.devidas@deepam.com', 'Human Resources & Administration', 'Head of Admin & HR'),
  ('DBYA0029', 'Satish Kumar V', 'dbya0029.deepam@gmail.com', 'Inventory & Warehouse', 'Warehouse & QC'),
  ('DBYA0030', 'CHANDRASHEKAR DURGA MANIKANTA', 'dbya0030.deepam@gmail.com', 'Inventory & Warehouse', 'Inventory Executive'),
  ('DBYA0008', 'ADITYA SHARMA', 'dbya0008.deepam@gmail.com', 'IT & Technology', 'Head of Technology & Automation'),
  ('DBYA0033', 'ABHISHEK THAPA', 'dbya0033.deepam@gmail.com', 'Marketing & CRM', 'Head of CRM'),
  ('DBYA0097', 'SHARANYA R', 'dbya0097.deepam@gmail.com', 'Marketing & CRM', 'Intern'),
  ('DBYA0001', 'Mohan A', 'dbya0001.deepam@gmail.com', 'Operations', 'Head Of Packaging'),
  ('DBYA0077', 'Ravi Kumar BS', 'dbya0077.deepam@gmail.com', 'Operations', 'Runner'),
  ('DBYA0078', 'Selvan M', 'dbya0078.deepam@gmail.com', 'Operations', 'Runner'),
  ('DBYA0095', 'Mohammed Kashif', 'dbya0095.deepam@gmail.com', 'Operations', 'Finishing Assistant'),
  ('DBYA0056', 'Babu M', 'dbya0056.deepam@gmail.com', 'Operations', 'Store Operation Assistant'),
  ('DBYA0057', 'Suresh L', 'dbya0057.deepam@gmail.com', 'Operations', 'Store Operation Assistant'),
  ('DBYA0074', 'Jyothi S', 'dbya0074.deepam@gmail.com', 'Operations', 'Store Operation Assistant'),
  ('DBYA0059', 'NIRAJAN BOHARA', 'dbya0059.deepam@gmail.com', 'Operations', 'Store Operation Assistant'),
  ('DBYA0076', 'Devraj H Y', 'dbya0076.deepam@gmail.com', 'Operations', 'Runner'),
  ('DBYA0073', 'SANJAY PANDITH', 'dbya0073.deepam@gmail.com', 'Operations', 'Store Operation Assistant'),
  ('DBYA0058', 'BIRENDER', 'dbya0058.deepam@gmail.com', 'Operations', 'Store Operation Assistant'),
  ('DBYA0065', 'SUJITH KUMAR', 'dbya0065.deepam@gmail.com', 'Operations', 'Store Operation Assistant'),
  ('DBYA0072', 'AHMED SAUD', 'dbya0072.deepam@gmail.com', 'Operations', 'Store Operation Assistant'),
  ('DBYA0069', 'ASMA', 'dbya0069.deepam@gmail.com', 'Operations', 'Store Operation Assistant'),
  ('DBYA0070', 'SHAMBU PATEL', 'dbya0070.deepam@gmail.com', 'Operations', 'Store Operation Assistant'),
  ('DBYA0096', 'SHANKAR M', 'dbya0096.deepam@gmail.com', 'Operations', 'Tailor'),
  ('DBYA0099', 'DHANUSHREE M', 'dbya0099.deepam@gmail.com', 'Operations', 'Store Operation Assistant'),
  ('DBYA0004', 'Manikandan M', 'manikandan@deepam.com', 'Procurement', 'Head of Procurement & Inventory'),
  ('DBYA0019', 'PRAMILA N V', 'dbya0019.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0013', 'Mary Josephine', 'dbya0013.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0068', 'KOMAL R', 'dbya0068.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0066', 'MANJESH KUMAR', 'dbya0066.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0025', 'Jyothi Damodar', 'dbya0025.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0042', 'Yuvaraj S', 'dbya0042.deepam@gmail.com', 'Sales', 'Junior Sales Executives'),
  ('DBYA0049', 'Raghu K R', 'dbya0049.deepam@gmail.com', 'Sales', 'Assistant Floor Manager'),
  ('DBYA0023', 'Anil Kumar Sharma', 'dbya0023.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0012', 'Krishna V N', 'dbya0012.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0048', 'Anitha', 'dbya0048.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0014', 'Padma H', 'dbya0014.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0020', 'Roopa S', 'dbya0020.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0022', 'Ranjini B', 'dbya0022.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0011', 'Swetha N', 'dbya0011.deepam@gmail.com', 'Sales', 'Floor Manager'),
  ('DBYA0017', 'Margaret Prema', 'dbya0017.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0026', 'M V RAJU', 'dbya0026.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0024', 'Anuradha', 'dbya0024.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0045', 'Kavya S', 'dbya0045.deepam@gmail.com', 'Sales', 'Junior Sales Executives'),
  ('DBYA0043', 'Venu Gopal S', 'dbya0043.deepam@gmail.com', 'Sales', 'Junior Sales Executives'),
  ('DBYA0050', 'PAVITHRA K', 'dbya0050.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0051', 'THANIGAIVELU D', 'dbya0051.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0041', 'Nisar Ahmed', 'dbya0041.deepam@gmail.com', 'Sales', 'Junior Sales Executives'),
  ('DBYA0046', 'Vijay Kumar', 'dbya0046.deepam@gmail.com', 'Sales', 'Junior Sales Executives'),
  ('DBYA0053', 'RAJEEV KUMAR', 'dbya0053.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0052', 'RAKESH KUMAR', 'dbya0052.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0015', 'SRINIVAS G', 'dbya0015.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0021', 'YASAR ARAFAT', 'dbya0021.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0054', 'VINAYAKA SAVANUR', 'dbya0054.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0016', 'PRATHIBA S', 'dbya0016.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0018', 'KOMALAVELLI', 'dbya0018.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0007', 'PARESH JIVANI', 'paresh@deepam.com', 'Sales', 'Store Head (Jayanagar)'),
  ('DBYA0027', 'SHEEJA', 'dbya0027.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0006', 'JAYAKUMAR', 'dbya0006.deepam@gmail.com', 'Sales', 'Store Head (MG Road)'),
  ('DBYA0044', 'ANNAPURNA', 'dbya0044.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0064', 'ROHITH', 'dbya0064.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0061', 'MD MAHFUZ', 'dbya0061.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0067', 'VIKASH KUMAR', 'dbya0067.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0062', 'M D SHAHZAD', 'dbya0062.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0063', 'RAJ KUMAR', 'dbya0063.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0047', 'AJITH KUMAR', 'dbya0047.deepam@gmail.com', 'Sales', 'Sales Assistant'),
  ('DBYA0098', 'KALAIVANI', 'dbya0098.deepam@gmail.com', 'Sales', 'Senior Sales Executives'),
  ('DBYA0080', 'Venket Rao', 'dbya0080.deepam@gmail.com', 'Security & Facilities', 'Valet Parking'),
  ('DBYA0079', 'Mahesh Patil', 'dbya0079.deepam@gmail.com', 'Security & Facilities', 'Valet Parking'),
  ('DBYA0037', 'MALLLIKARJUNA SWAMY H K', 'dbya0037.deepam@gmail.com', 'Security & Facilities', 'Security Supervisor'),
  ('DBYA0038', 'MAN SINGH', 'dbya0038.deepam@gmail.com', 'Security & Facilities', 'Head Of Security'),
  ('DBYA0092', 'NAGARATHNA', 'dbya0092.deepam@gmail.com', 'Security & Facilities', 'Security'),
  ('DBYA0083', 'JAYANTH A', 'dbya0083.deepam@gmail.com', 'Security & Facilities', 'Pantry Assistant'),
  ('DBYA0084', 'UMA M', 'dbya0084.deepam@gmail.com', 'Security & Facilities', 'Housekeeping'),
  ('DBYA0086', 'LATHA G', 'dbya0086.deepam@gmail.com', 'Security & Facilities', 'Housekeeping'),
  ('DBYA0082', 'PREMANANDA DAS', 'dbya0082.deepam@gmail.com', 'Security & Facilities', 'Lift Operator'),
  ('DBYA0093', 'SHRAVAN KUMAR YADAV', 'dbya0093.deepam@gmail.com', 'Security & Facilities', 'Security'),
  ('DBYA0087', 'EALAM UDDIN', 'dbya0087.deepam@gmail.com', 'Security & Facilities', 'Housekeeping'),
  ('DBYA0091', 'AMIT DEY', 'dbya0091.deepam@gmail.com', 'Security & Facilities', 'Pantry Assistant'),
  ('DBYA0089', 'SHYAMAL DEBNATH', 'dbya0089.deepam@gmail.com', 'Security & Facilities', 'Housekeeping'),
  ('DBYA0085', 'ANITHA AMULRAJ', 'dbya0085.deepam@gmail.com', 'Security & Facilities', 'Housekeeping'),
  ('DBYA0081', 'VASUDEVAN K', 'dbya0081.deepam@gmail.com', 'Security & Facilities', 'Valet Parking'),
  ('DBYA0090', 'N KUMAR', 'dbya0090.deepam@gmail.com', 'Security & Facilities', 'Housekeeping')

ON CONFLICT (employee_code) DO NOTHING;
