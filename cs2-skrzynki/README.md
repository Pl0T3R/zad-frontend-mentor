# CS2 Case Lab – symulator skrzynek

Lokalna strona do otwierania skrzynek CS2 z upgraderem. Wszystkie pieniądze są wirtualne,
a saldo, ekwipunek i statystyki zapisują się w `localStorage` Twojej przeglądarki.

## Jak uruchomić

Otwórz `index.html` w przeglądarce (dwuklik). Nie trzeba nic instalować ani uruchamiać serwera.

## Co potrafi

- **Skrzynki** – 5 skrzynek wzorowanych na CS2 (prawdziwe szanse rzadkości) i 4 specjalne
  (tania, same AWP, noże, rękawice). Animowana ruletka, otwieranie 1–5 skrzynek naraz, tryb szybki.
- **Dropy** – losowe zużycie (FN/MW/FT/WW/BS) z floatem, 10% szansy na StatTrak™, cena zależna od zużycia.
- **Dodawanie środków** – przycisk „+ Dodaj środki” w nagłówku.
- **Ekwipunek** – sortowanie, zaznaczanie, sprzedaż pojedyncza/zaznaczonych/wszystkich, statystyki i reset konta.
- **Upgrader** – stawiasz do 8 skinów, wybierasz droższy cel (lub mnożnik x1,5–x10),
  szansa = wartość wkładu ÷ wartość celu × 95%. Wygrana daje cel, przegrana zabiera wkład.

## Pliki

- `index.html` – szkielet strony i okna dialogowe
- `style.css` – wygląd (ciemny motyw, kolory rzadkości, wersja mobilna)
- `data.js` – skrzynki i skiny: tu dodasz własną skrzynkę albo zmienisz ceny
- `app.js` – cała logika: losowanie, ruletka, ekwipunek, upgrader, zapis stanu
