"""Check population accounting and parameter recovery independently of the workflow."""
import math
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pipeline'))
from age_model import equilibrium, trajectory, fit, fishing_mortality, AGES, WEIGHT, SELECTIVITY

for mortality in (0.2, 0.3):
    result = trajectory(20000, mortality, [0] * 35)
    initial = result['rows'][0]['numbers']
    for row in result['rows']:
        assert math.isclose(row['SB_over_SB0'], 1.0, rel_tol=1e-12)
        assert all(math.isclose(a, b, rel_tol=1e-12) for a, b in zip(initial, row['numbers']))
    n = equilibrium(1000, mortality)
    assert math.isclose(sum(n), 1000 / (1 - math.exp(-mortality)), rel_tol=1e-12)
    for known_f in (0.01, 0.2, 1.5):
        vulnerable = 14000.0
        catch = vulnerable * known_f / (known_f + mortality) * (1 - math.exp(-known_f - mortality))
        recovered = fishing_mortality(catch, vulnerable, mortality)
        assert math.isclose(known_f, recovered, rel_tol=1e-9)
    catches = [500 + 200 * math.sin(i / 5) + 9 * i for i in range(30)]
    known = trajectory(22000, mortality, catches)
    for i, row in enumerate(known['rows']):
        # Independently sum catch in numbers at age, converted to tonnes.
        catch = sum(n * w * (row['F'] * s) / (mortality + row['F'] * s)
                    * (1 - math.exp(-mortality - row['F'] * s))
                    for n, w, s in zip(row['numbers'], WEIGHT, SELECTIVITY))
        assert math.isclose(catch, catches[i], rel_tol=1e-8)
        if i:
            prev = known['rows'][i - 1]
            expected_plus = sum(prev['numbers'][a] * math.exp(-mortality - prev['F'] * SELECTIVITY[a]) for a in (9, 10))
            assert math.isclose(row['numbers'][-1], expected_plus, rel_tol=1e-12)
    q = 0.00007
    recovered = fit([q * r['vulnerable_biomass'] for r in known['rows']], catches, mortality)
    assert math.isclose(recovered['B0'], 22000, rel_tol=1e-6)
    assert math.isclose(recovered['q'], q, rel_tol=1e-6)
    assert recovered['log_index_SSE'] < 1e-12
assert fishing_mortality(100, 99, 0.2) is None
print('Age model checked: unfished equilibrium, plus group, Baranov catches and recovery of biomass scale/catchability for both M assumptions.')
