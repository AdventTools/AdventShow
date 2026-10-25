## Deschise

- Certificatul vechi pe calculatoarele bisericilor: urmarit in hangar, la rapoartele automate „Certificat vechi AdventShow: scos / refuzat / esuat".
- Corecturile la 260 de imnuri (2026-10-25) sunt in `public/hymns.db`; pleaca la biserici cu urmatorul release, dupa care ruleaza `scripts/push_baseline.py`. Ownerul a cerut sa nu se faca release pana nu spune el.
- Dupa release: propunerea #340 din hangar (IC 896, corecta, deja rezolvata in baza) se inchide.
- Mesajul de la import pentru imnurile care exista deja oficial n-a fost vazut in aplicatie (lipseste un PowerPoint de imn pentru test); regula de recunoastere e verificata pe cele 211 copii reale.
- Imnuri de verificat de un om din biserica: 18, cu comentariu fiecare, in `docs/ops/de-verificat-imnuri.json`. Asteapta coada „De verificat” din hangar (textul pentru agentul hangar i-a fost dat ownerului pe 2026-10-25); dupa ce exista, se importa lista acolo.
- De decis de owner:
  - spargerea strofelor de 11-12 randuri in doua slide-uri („Strofa 1 (continuare)”, cere o mica schimbare in aplicatie): IC 120, 206, 517, 548, 583, 774, 807, 826, 896, Exploratori 053, 058, 064, 098, Licurici 078;
  - scurtarea celor 50 de imnuri care au acelasi vers scris de doua ori la rand, cu [: … :] (si [: … :] ×3);