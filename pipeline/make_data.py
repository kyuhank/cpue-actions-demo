"""Create or append to a tiny, wholly synthetic operational database."""
import argparse
import math
from pathlib import Path
import random
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data/toy-fishery.sqlite"


def poisson(rng, mean):
    product, n = 1.0, 0
    while product > math.exp(-mean):
        product *= rng.random()
        n += 1
    return n - 1


def annual_values(year):
    biomass, capacity, growth = 10000.0, 10000.0, 0.35
    for y in range(2000, year + 1):
        t = y - 2000
        removals = 350 + 34 * t if t < 19 else 996 - 25 * (t - 19)
        removals = max(350, removals)
        if y == year:
            return biomass, removals
        biomass += growth * biomass * (1 - biomass / capacity) - removals


def add_year(db, year):
    rng = random.Random(20261012 + year)
    biomass, removals = annual_values(year)
    vessels, effects = ["v01", "v02", "v03", "v04"], [0.6, 0.9, 1.3, 1.8]
    shift = min((year - 2000) / 25, 1)
    weights = [45 - 35 * shift, 30 - 15 * shift, 15 + 10 * shift, 10 + 40 * shift]
    rows = []
    for s in range(240):
        vessel = rng.choices(range(4), weights=weights)[0]
        hooks = rng.choice([800, 1000, 1200, 1500])
        mean = 0.001 * biomass * effects[vessel] * hooks / 1000
        rows.append((f"{year}-{s:04d}", year, vessels[vessel], hooks, poisson(rng, mean)))
    db.executemany("INSERT INTO sets VALUES (?, ?, ?, ?, ?)", rows)
    db.execute("INSERT INTO removals VALUES (?, ?)", (year, removals))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--append", action="store_true", help="Add one new synthetic year")
    args = parser.parse_args()
    DATABASE.parent.mkdir(exist_ok=True)
    if DATABASE.exists() and not args.append:
        raise SystemExit("Database exists. Use --append to add one synthetic year.")
    with sqlite3.connect(DATABASE) as db:
        db.execute("CREATE TABLE IF NOT EXISTS sets (set_id TEXT PRIMARY KEY, year INTEGER NOT NULL, vessel TEXT NOT NULL, hooks INTEGER NOT NULL CHECK(hooks > 0), catch_n INTEGER NOT NULL CHECK(catch_n >= 0))")
        db.execute("CREATE TABLE IF NOT EXISTS removals (year INTEGER PRIMARY KEY, catch_t REAL NOT NULL CHECK(catch_t >= 0))")
        last = db.execute("SELECT MAX(year) FROM removals").fetchone()[0]
        years = [last + 1] if last is not None else range(2000, 2024)
        for year in years:
            if year > 2035:
                raise SystemExit("Toy series ends in 2035; restore the baseline for another rehearsal.")
            add_year(db, year)
        print(f"Synthetic database now ends in {year}; {db.execute('SELECT COUNT(*) FROM sets').fetchone()[0]} sets.")


if __name__ == "__main__":
    main()

