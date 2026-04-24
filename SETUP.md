# 📷 CamShop — คู่มือเซ็ตอัพฉบับสมบูรณ์
### สำหรับคนที่ไม่มีความรู้ด้านโค้ด อ่านทีละขั้นได้เลย

---

## ก่อนเริ่ม — ต้องมีอะไรบ้าง?

- คอมพิวเตอร์ที่ต่ออินเทอร์เน็ตได้
- เบราว์เซอร์ (Chrome แนะนำ)
- เวลาประมาณ 30-45 นาที

ทั้งหมดที่ใช้ **ฟรี** ครับ

---

## ขั้นตอนที่ 1 — สร้างฐานข้อมูลบน Supabase (ฟรี)

> 💡 Supabase คือที่เก็บข้อมูลร้านบน Cloud ทำงานเหมือน Excel บน internet แต่เร็วกว่าและปลอดภัยกว่ามาก

### 1.1 สมัครบัญชี Supabase

1. เปิดเบราว์เซอร์ ไปที่ **https://supabase.com**
2. กดปุ่ม **"Start your project"** หรือ **"Sign Up"** (มุมขวาบน)
3. เลือก **"Continue with GitHub"**
   - ถ้ายังไม่มี GitHub: ไปสมัครที่ **https://github.com** ก่อน (ฟรี, ใช้ 2 นาที)
4. ยืนยัน และรอจนเข้าหน้า Dashboard ของ Supabase

### 1.2 สร้าง Project ใหม่

1. กดปุ่ม **"New Project"** (สีเขียว)
2. กรอกข้อมูล:
   - **Organization**: กดสร้างใหม่ ตั้งชื่ออะไรก็ได้
   - **Project name**: `camshop`
   - **Database Password**: ตั้งรหัสผ่านแข็งแรง **บันทึกไว้!** (ไม่ได้ใช้บ่อย แต่ต้องเก็บไว้)
   - **Region**: เลือก **Southeast Asia (Singapore)** ← ใกล้ไทยที่สุด
3. กด **"Create new project"**
4. รอประมาณ **1-2 นาที** จนขึ้นว่า "Project is ready"

---

## ขั้นตอนที่ 2 — สร้างตารางข้อมูลทั้งหมด

> 💡 ขั้นตอนนี้คือการบอก Supabase ว่าร้านเราต้องเก็บข้อมูลอะไรบ้าง เช่น กล้อง, บัญชี, อุปกรณ์เสริม

1. ใน Supabase Dashboard ด้านซ้ายมือ มีไอคอนต่างๆ — มองหาไอคอนที่ดูเหมือนหน้าจอ SQL หรือกด **"SQL Editor"**
2. กด **"New query"** (ปุ่ม + ด้านบน)
3. เปิดไฟล์ **`supabase_migration.sql`** จากโฟลเดอร์ที่ดาวน์โหลดมา
   - Windows: คลิกขวา → Open with → Notepad
   - Mac: คลิกขวา → Open with → TextEdit
4. กด **Ctrl+A** (Windows) หรือ **Cmd+A** (Mac) เพื่อเลือกทั้งหมด
5. กด **Ctrl+C** / **Cmd+C** เพื่อคัดลอก
6. กลับไปที่ Supabase SQL Editor → คลิกในกล่องพิมพ์ → กด **Ctrl+V** / **Cmd+V** เพื่อวาง
7. กดปุ่ม **"Run"** (สีเขียว ด้านขวาบน) หรือกด **Ctrl+Enter**
8. รอจนขึ้น **"Success"** ✅

---

## ขั้นตอนที่ 3 — สร้างบัญชีผู้ใช้สำหรับ Login

1. ใน Supabase Dashboard → เมนูซ้าย → **Authentication**
2. กด **"Users"**
3. กดปุ่ม **"Add user"** → **"Create new user"**
4. กรอก:
   - **Email**: อีเมลที่ต้องการใช้ Login
   - **Password**: รหัสผ่านที่ต้องการ (จำให้ได้!)
   - **ติ๊กถูก "Auto Confirm User"** ✅ ← สำคัญมาก
5. กด **"Create User"**

---

## ขั้นตอนที่ 4 — เก็บ "กุญแจ" เชื่อมต่อ

> 💡 Supabase จะให้ "กุญแจ" 2 ดอก ที่แอปเราต้องใช้เพื่อรู้ว่าจะเชื่อมกับฐานข้อมูลไหน

1. เมนูซ้าย Supabase → ไอคอนฟันเฟือง **"Project Settings"** (ล่างสุด)
2. เลือก **"API"**
3. คัดลอก **2 ค่า** นี้ไว้ (เปิด Notepad แล้ว paste เก็บไว้ก่อน):
   - **Project URL** — ตัวอย่าง: `https://abcdefgh.supabase.co`
   - **anon public** key — ยาวมาก เริ่มต้นด้วย `eyJ...`

---

## ขั้นตอนที่ 5 — ติดตั้ง Node.js (ทำครั้งเดียวตลอดชีพ)

> 💡 Node.js คือโปรแกรมพื้นฐานที่จำเป็น เปรียบเหมือน Java ที่บางโปรแกรมต้องการ

1. ไปที่ **https://nodejs.org**
2. กดปุ่มสีเขียวฝั่งซ้ายที่เขียนว่า **"LTS"**
3. ดาวน์โหลดและติดตั้งเหมือนโปรแกรมทั่วไป (Next → Next → Install)
4. รีสตาร์ทคอมพิวเตอร์ถ้าระบบขอ

---

## ขั้นตอนที่ 6 — ดาวน์โหลดและจัดวางโปรเจกต์

1. ดาวน์โหลดไฟล์ **`camshop-supabase.zip`** จากที่ได้รับมา
2. คลิกขวา → **"Extract All..."** → เลือกวางที่ Desktop หรือ Documents
3. จะได้โฟลเดอร์ชื่อ **`camshop-supabase`**

---

## ขั้นตอนที่ 7 — ใส่ "กุญแจ" เชื่อมต่อ Supabase

1. เข้าไปในโฟลเดอร์ `camshop-supabase`
2. หาไฟล์ **`.env.example`**
   > ⚠️ ถ้าไม่เห็นไฟล์นี้: ใน Windows Explorer → View → ติ๊ก "Hidden items"
3. คลิกขวาที่ `.env.example` → Copy → Paste ในโฟลเดอร์เดิม
4. เปลี่ยนชื่อไฟล์ที่ copy มาเป็น **`.env`** (ลบ `.example` ออก)
   - ถ้า Windows ไม่ยอม: เปิด Notepad → File → Save As → พิมพ์ `.env` → Save ในโฟลเดอร์ camshop-supabase
5. เปิดไฟล์ `.env` ด้วย Notepad แล้วแก้ค่าทั้ง 2 บรรทัด:

```
VITE_SUPABASE_URL=วาง Project URL ของคุณที่นี่
VITE_SUPABASE_ANON_KEY=วาง anon public key ของคุณที่นี่
```

ตัวอย่างหลังกรอกแล้ว:
```
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

6. บันทึกไฟล์ (Ctrl+S)

---

## ขั้นตอนที่ 8 — เปิด Terminal และรันแอป

**วิธีเปิด Terminal:**

- **Windows**: เข้าโฟลเดอร์ `camshop-supabase` → คลิกที่ช่อง address bar ด้านบน → พิมพ์ `cmd` → Enter
- **Mac**: คลิกขวาที่โฟลเดอร์ → "New Terminal at Folder"

**พิมพ์คำสั่งนี้แล้วกด Enter** (ทำครั้งเดียว):
```
npm install
```
รอประมาณ 1-3 นาที จนหยุดเอง

**พิมพ์คำสั่งนี้เพื่อเปิดแอป:**
```
npm run dev
```
จะเห็น:
```
VITE ready → Local: http://localhost:5173/
```

**เปิดเบราว์เซอร์** ไปที่ **http://localhost:5173** → Login ด้วย email/password ที่สร้างในขั้นตอนที่ 3

> ⚠️ ต้องเปิด Terminal ทิ้งไว้ตลอดเวลาใช้งาน ถ้าปิด Terminal แอปจะหยุด

---

## ขั้นตอนที่ 9 — Deploy ขึ้น Cloud (ใช้มือถือได้ตลอด 24 ชม.)

> 💡 ตอนนี้แอปยังอยู่แค่ในคอมพิวเตอร์เรา ขั้นตอนนี้คือการ "ขึ้นเว็บ" ให้เปิดได้จากมือถือทุกที่ — ฟรี

### 9.1 สมัคร Vercel

1. ไปที่ **https://vercel.com** → **"Sign Up"** → **"Continue with GitHub"**
2. ยืนยันสิทธิ์ให้ Vercel เข้าถึง GitHub

### 9.2 อัปโหลดโค้ดขึ้น GitHub

1. ไปที่ **https://github.com** → ล็อกอิน → กด **"New"** (ปุ่มสีเขียว)
2. ตั้งชื่อ Repository: `camshop` → เลือก **Private** → **"Create repository"**
3. เปิด Terminal ในโฟลเดอร์ `camshop-supabase` แล้วพิมพ์ทีละบรรทัด:

```
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/ชื่อ-GitHub-ของคุณ/camshop.git
git push -u origin main
```

> แทน `ชื่อ-GitHub-ของคุณ` ด้วย username GitHub จริงๆ

### 9.3 Deploy บน Vercel

1. ไปที่ **https://vercel.com** → **"Add New Project"**
2. เลือก repository `camshop` → **"Import"**
3. **ก่อนกด Deploy** — กด **"Environment Variables"** แล้วเพิ่ม 2 รายการ:

   | Name | Value |
   |------|-------|
   | `VITE_SUPABASE_URL` | Project URL จาก Supabase |
   | `VITE_SUPABASE_ANON_KEY` | anon key จาก Supabase |

4. กด **"Deploy"** 🚀
5. รอ 1-2 นาที → จะได้ URL เช่น `https://camshop-xxx.vercel.app`

### 9.4 เพิ่มเป็นแอปบนมือถือ

1. เปิด URL จาก Vercel บนมือถือ
2. **iOS**: กดปุ่ม Share → "Add to Home Screen"
3. **Android**: กดเมนู 3 จุด → "Add to Home Screen"
4. จะได้ไอคอนแอปบนหน้าจอ ใช้งานได้เหมือน App Store เลยครับ ✅

---

## สรุปฟีเจอร์ที่ทำงานอัตโนมัติ

| เมื่อ... | ระบบทำให้อัตโนมัติ |
|---|---|
| รับสินค้าเข้า | สร้างรายจ่าย "Buy Stock" |
| เพิ่มอุปกรณ์เสริม | บวกต้นทุนรวม + สร้างรายจ่าย "Add-on" |
| กดขาย | สร้างรายรับ + กำหนดประกัน 15 วัน |
| ลบอุปกรณ์เสริม | หักต้นทุน + ลบรายการบัญชีที่เกี่ยวข้อง |
| ลบสินค้า | ลบทุกอย่างที่เกี่ยวข้องทั้งหมด |
| แก้ราคาซื้อ | คำนวณต้นทุนรวมใหม่อัตโนมัติ |
