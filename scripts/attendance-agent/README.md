# Attendance sync: Matrix COSEC → CRM

Sends punches from the biometric machine's database (Matrix COSEC, SQL Server `ADMIN-PC\MATRIXDB`, database `cosec`,
table `Mx_ATDEventTrn`) to the CRM, where they show on **HR Intelligence → Attendance**. The CRM is in the cloud and
can't reach the office PC, so this small job runs **on a PC in the office** and sends new punches every few minutes.

| COSEC column | Meaning | Sent as |
|---|---|---|
| `UserID` | employee's ID on the machine | `userId` (matched to the employee's **Biometric ID** in the CRM, leading zeros ignored) |
| `Edatetime` | punch time (IST) | `at` |
| `IOTYPE` | 0 = IN, 1 = OUT | `io` |
| `Idatetime` | when the machine's punches were downloaded | `downloadedAt` (how far the job has got) |

## How the CRM reads a day
First IN to last OUT. Under 5 hours between them is a **Half day**, otherwise **Present**. Days with no punch stay empty
(week offs and leave are not on the machine). A day HR enters by hand is never overwritten.

## Set up (once, on ADMIN-PC or any office PC that can reach it)
1. Copy this folder to the PC, e.g. `C:\deepam-attendance`.
2. Copy `config.example.json` to `config.json` and fill in:
   - `sqlConnectionString`: the SQL login. On ADMIN-PC itself the server can be `.\MATRIXDB`. A read-only login is safer than `sa`
     (see below).
   - `startFrom`: the first punch download time to send, e.g. the 1st of the month.
   - each target's `token`: the CRM's `ATTENDANCE_SYNC_TOKEN` (ask whoever deploys the CRM).
3. Try it: open PowerShell in the folder and run
   `powershell -ExecutionPolicy Bypass -File .\sync-cosec.ps1`
   It prints e.g. `app-runner: sent 412 punches, 412 new`. Check HR → Attendance.
4. Schedule it (Command Prompt as administrator, one line):
   ```
   schtasks /Create /TN "Deepam attendance sync" /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\deepam-attendance\sync-cosec.ps1"
   ```
   It then runs every 5 minutes while the PC is on. Punches made while it is off are sent when it is next on.

`state.json` remembers how far it got (delete it to resend everything from `startFrom`; repeats are ignored).
`sync.log` shows each run. Neither, nor `config.json`, belongs in git.

## A read-only SQL login (recommended instead of `sa`)
In SQL Server Management Studio, connected to `ADMIN-PC\MATRIXDB`:
```sql
CREATE LOGIN deepam_attendance WITH PASSWORD = 'choose-a-long-password';
USE cosec;
CREATE USER deepam_attendance FOR LOGIN deepam_attendance;
GRANT SELECT ON dbo.Mx_ATDEventTrn TO deepam_attendance;
```
The server must allow SQL Server logins (mixed mode), which it already does since `sa` works.
