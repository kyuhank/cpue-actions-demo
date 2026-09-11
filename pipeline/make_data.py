"""Create or append to a tiny, wholly synthetic operational database."""
import argparse
import math
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data/toy-fishery.sqlite"


class Random:
    """Small reproducible generator shared with the browser companion."""
    def __init__(self, seed):
        self.seed = seed & 0xffffffff

    def random(self):
        self.seed = (1664525 * self.seed + 1013904223) & 0xffffffff
        return (self.seed + 0.5) / 4294967296

    def normal(self):
        return math.sqrt(-2 * math.log(self.random())) * math.cos(2 * math.pi * self.random())


def poisson(rng, mean):
    product, n = 1.0, 0
    while product > math.exp(-mean):
        product *= rng.random()
        n += 1
    return n - 1


def annual_values(year):
    # Rising then easing removals; correlated availability adds annual CPUE variation.
    rng = Random(20261012)
    biomass, availability = 10000.0, 0.0
    for y in range(2000, year + 1):
        t = y - 2000
        catch_trend = 400 + 42 * t if t <= 16 else max(580, 1072 - 65 * (t - 16))
        removals = round(catch_trend * math.exp(0.09 * rng.normal() - 0.09**2 / 2), 2)
        innovation = rng.normal()
        availability = 0.45 * availability + (0 if t == 0 else 0.14 * innovation)
        if y == year:
            return biomass * math.exp(availability), removals
        biomass += 0.35 * biomass * (1 - biomass / 10000) - removals


def year_records(year):
    rng = Random(20261012 + year * 7919)
    abundance, removals = annual_values(year)
    vessels, effects = ["v01", "v02", "v03", "v04"], [0.6, 0.9, 1.3, 1.8]
    shift = min((year - 2000) / 25, 1)
    weights = [45 - 35 * shift, 30 - 15 * shift, 15 + 10 * shift, 10 + 40 * shift]
    rows = []
    count = 180 + int(rng.random() * 120)
    for s in range(count):
        u, vessel = rng.random() * sum(weights), 0
        while u > weights[vessel] and vessel < 3:
            u -= weights[vessel]
            vessel += 1
        hooks = [800, 1200, 1600, 2000, 2400][int(rng.random() * 5)]
        # Lognormal set heterogeneity produces overdispersed catches, including zeros.
        encounter = math.exp(0.75 * rng.normal() - 0.75**2 / 2)
        mean = 0.00055 * abundance * effects[vessel] * hooks / 1000 * encounter
        rows.append((f"{year}-{s:04d}", year, vessels[vessel], hooks, poisson(rng, mean)))
    return rows, removals


def add_year(db, year):
    rows, removals = year_records(year)
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

