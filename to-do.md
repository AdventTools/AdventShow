## Deschise

- Certificatul vechi pe calculatoarele bisericilor: urmarit in hangar, la rapoartele automate „Certificat vechi AdventShow: scos / refuzat / esuat".
- Corecturile la 260 de imnuri (2026-10-25) sunt in `public/hymns.db`; pleaca la biserici cu urmatorul release, dupa care ruleaza `scripts/push_baseline.py`. Ownerul a cerut sa nu se faca release pana nu spune el.
- Dupa release: propunerea #340 din hangar (IC 896, corecta, deja rezolvata in baza) se inchide.
- Mesajul de la import pentru imnurile care exista deja oficial n-a fost vazut in aplicatie (lipseste un PowerPoint de imn pentru test); regula de recunoastere e verificata pe cele 211 copii reale.
- Moderarea trece toata in hangar (decizia ownerului, 2026-10-25): texte si sincronizarea acompaniamentului, cu cont de verificator si proba de ascultare in hangar (textul pentru agentul hangar i-a fost dat ownerului). Dupa ce ownerul spune ca sincronizarea e gata: se scoate din aplicatie meniul de administrare (`Ctrl+Alt+Shift+M`, vizualizarea marcajelor); redarea cu marcaje ramane.
- Imnuri de verificat de un om din biserica: 18, cu comentariu fiecare, in `docs/ops/de-verificat-imnuri.json`. Asteapta coada „De verificat” din hangar (textul pentru agentul hangar i-a fost dat ownerului pe 2026-10-25); dupa ce exista, se importa lista acolo.