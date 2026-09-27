// Extension point only. No synthetic algorithms in LIVE mode.
export class CustomSystemSignal {
  async scan(_context) {
    return [];
  }
}
