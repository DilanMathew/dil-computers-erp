#!/usr/bin/env python3
"""Generate synthetic monthly sales registers for May 2026 onward.

April 2026 (april_2026_sales.csv) is REAL data exported from Tally. Every
other <month>_2026_sales.csv in this directory is synthetic filler produced
by this script so the app has a full year-to-date to chart against.

What it borrows from April, per customer: which voucher categories that
customer actually buys, how often they appear, and the range of amounts
they spend. What it invents: the specific dates and amounts. Nothing here
is a real transaction.

Voucher numbers continue April's four series (Sales 0087/2026-2027 onward,
Service DIL/038/26-27 onward, AMC DIL/AMC/5/26-27 onward, Rental
003/26-27 onward), so the whole year is one unbroken run and the importer's
per-voucher idempotency still holds.

Seeded RNG: re-running overwrites the files with byte-identical content,
so regenerating never creates a second set of invoices in an already-seeded
database.

Usage:  python3 generate_monthly_sales.py
"""

import calendar
import collections
import csv
import datetime as dt
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
APRIL = os.path.join(HERE, 'april_2026_sales.csv')

# Through 5 Sep 2026 — the app's "today" when this data was generated.
LAST_DAY = dt.date(2026, 9, 5)
MONTHS = [(2026, 5), (2026, 6), (2026, 7), (2026, 8), (2026, 9)]

# (category, label) pairs exactly as April spells them.
KIND_SALES = ('Sales', 'Sales')
KIND_SERVICE = ('Service', 'Service')
KIND_AMC = ('AMC', 'AMC Maintenance')
KIND_RENTAL = ('Rental', 'Rental Income')

SEED = 20260905


def load_april():
    with open(APRIL, newline='', encoding='utf-8') as fh:
        return list(csv.DictReader(fh))


def profile_customers(rows):
    """Per customer: how many April vouchers, of which kinds, at what amounts."""
    profiles = collections.defaultdict(
        lambda: {'count': 0, 'kinds': collections.Counter(), 'amounts': collections.defaultdict(list)}
    )
    for r in rows:
        name = r['customer_name'].strip()
        kind = (r['category'].strip(), r['label'].strip())
        p = profiles[name]
        p['count'] += 1
        p['kinds'][kind] += 1
        p['amounts'][kind].append(float(r['amount']))
    return profiles


def next_sequences(rows):
    """Highest number used in each April series, so May continues from it."""
    seqs = {'sales': 0, 'service': 0, 'amc': 0, 'rental': 0}
    for r in rows:
        v = r['voucher_no'].strip()
        if v.startswith('DIL/AMC/'):
            seqs['amc'] = max(seqs['amc'], int(v.split('/')[2]))
        elif v.startswith('DIL/'):
            seqs['service'] = max(seqs['service'], int(v.split('/')[1]))
        elif v.endswith('/2026-2027'):
            seqs['sales'] = max(seqs['sales'], int(v.split('/')[0]))
        elif v.endswith('/26-27'):
            seqs['rental'] = max(seqs['rental'], int(v.split('/')[0]))
    return seqs


def voucher_number(kind, seqs):
    if kind == KIND_SALES:
        seqs['sales'] += 1
        return f"{seqs['sales']:04d}/2026-2027"
    if kind == KIND_SERVICE:
        seqs['service'] += 1
        return f"DIL/{seqs['service']:03d}/26-27"
    if kind == KIND_AMC:
        seqs['amc'] += 1
        return f"DIL/AMC/{seqs['amc']}/26-27"
    seqs['rental'] += 1
    return f"{seqs['rental']:03d}/26-27"


def working_days(year, month, rng):
    """Weekdays plus most Saturdays — a shop that shuts on Sundays."""
    last = calendar.monthrange(year, month)[1]
    days = []
    for d in range(1, last + 1):
        day = dt.date(year, month, d)
        if day > LAST_DAY:
            break
        if day.weekday() == 6:            # Sunday: closed
            continue
        if day.weekday() == 5 and rng.random() < 0.35:   # some Saturdays off
            continue
        days.append(day)
    return days


def pick_amount(rng, samples):
    """Jitter a real April amount by ±35%, rounded the way a till rounds."""
    base = rng.choice(samples)
    amount = base * rng.uniform(0.65, 1.35)
    if amount >= 10000:
        return round(amount, -2)
    if amount >= 1000:
        return round(amount, -1)
    return max(50.0, round(amount))


def generate_month(year, month, profiles, seqs, rng):
    days = working_days(year, month, rng)
    if not days:
        return []
    # April ran 128 vouchers over a full month; scale that to the days open,
    # with a little month-to-month variation.
    per_day = 128 / 25.0
    target = max(1, int(round(len(days) * per_day * rng.uniform(0.85, 1.15))))

    names = list(profiles)
    weights = [profiles[n]['count'] for n in names]

    rows = []
    monthly_done = set()   # one AMC / one rental per customer per month
    for _ in range(target):
        name = rng.choices(names, weights=weights, k=1)[0]
        p = profiles[name]
        kind = rng.choices(list(p['kinds']), weights=list(p['kinds'].values()), k=1)[0]

        if kind in (KIND_AMC, KIND_RENTAL):
            if (name, kind) in monthly_done:
                kind = KIND_SALES if KIND_SALES in p['kinds'] else KIND_SERVICE
            else:
                monthly_done.add((name, kind))

        samples = p['amounts'].get(kind) or [a for lst in p['amounts'].values() for a in lst]
        rows.append({
            'date': rng.choice(days),
            'customer_name': name,
            'category': kind[0],
            'label': kind[1],
            'amount': pick_amount(rng, samples),
            'kind': kind,
        })

    # Voucher numbers are issued in date order, as they would be in the shop.
    rows.sort(key=lambda r: r['date'])
    for r in rows:
        r['voucher_no'] = voucher_number(r.pop('kind'), seqs)
    return rows


def main():
    april = load_april()
    profiles = profile_customers(april)
    seqs = next_sequences(april)
    rng = random.Random(SEED)

    grand_total = 0.0
    for year, month in MONTHS:
        rows = generate_month(year, month, profiles, seqs, rng)
        if not rows:
            continue
        name = dt.date(year, month, 1).strftime('%B').lower()
        path = os.path.join(HERE, f'{name}_{year}_sales.csv')
        with open(path, 'w', newline='', encoding='utf-8') as fh:
            w = csv.DictWriter(
                fh, fieldnames=['date', 'customer_name', 'category', 'label', 'voucher_no', 'amount']
            )
            w.writeheader()
            for r in rows:
                w.writerow({
                    'date': r['date'].isoformat(),
                    'customer_name': r['customer_name'],
                    'category': r['category'],
                    'label': r['label'],
                    'voucher_no': r['voucher_no'],
                    'amount': f"{r['amount']:.1f}",
                })
        total = sum(r['amount'] for r in rows)
        grand_total += total
        print(f'{name.title()} {year}: {len(rows):3d} vouchers, Rs. {total:,.2f}  -> {os.path.basename(path)}')
    print(f'Total generated: Rs. {grand_total:,.2f}')


if __name__ == '__main__':
    main()
