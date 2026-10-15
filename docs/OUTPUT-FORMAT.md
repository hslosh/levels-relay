# Output format

Each market gets **38 comma-separated numbers**: the same format the Auto-GEX Master Levels AI prompt produces, so nothing changes for anyone pasting them in.

| Positions | Session |
|---|---|
| 1–19 | EOD levels |
| 20–38 | Intraday levels (same order) |

The 19 levels, in order:

| # | Level | # | Level |
|---|---|---|---|
| 1 | GEX 1 | 11 | Call Resistance |
| 2 | GEX 2 | 12 | Call Resistance 0DTE |
| 3 | GEX 3 | 13 | Put Support |
| 4 | GEX 4 | 14 | Put Support 0DTE |
| 5 | GEX 5 | 15 | HVL |
| 6 | GEX 6 | 16 | HVL 0DTE |
| 7 | GEX 7 | 17 | Gamma Wall 0DTE |
| 8 | GEX 8 | 18 | 1D Max |
| 9 | GEX 9 | 19 | 1D Min |
| 10 | GEX 10 | | |

`0` means that level isn't on the chart for that session. The indicator skips zeros.

Which indicator box each market goes in: NQ → *NQ / MNQ Levels* · ES → *ES / MES Levels* · GC → *GC / MGC Levels* · OIL → *CL / MCL Levels* · SILVER → *SI / SIL Levels*.
