# Spendy product requirements

## Project Overview
High-level product description for the Spendy wallet.

## Stack
- Target stack: Flutter client + FastAPI backend (per product brief)
- MUST support OTP sign-in and Google/Apple auth providers

## Payments
- MUST support EGP currency for Egyptian users
- MUST wire real authentication (not mock-only screens)
- MUST integrate @supabase/supabase-js with live data entry

## Features
- MUST provide expense categories and monthly reports
- SHOULD support QR scan onboarding via Expo Go
- MUST provide a working Logout button with onPress handler
- MUST support voice recognition input with microphone recording
- MUST support OCR receipt scanning via camera APIs
