@echo off
cd /d "D:\Claude code\Goblins-POS"
git add -A
git commit -m "sync: %date% %time%"
git push origin main
echo Done! Railway and Vercel will auto-deploy now.
pause
