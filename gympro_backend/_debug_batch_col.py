from salon_fastapi.stock_in import _reflect_table, _pick_batch_column


def main() -> None:
    t = _reflect_table("stock_transactions_summary")
    cols = set(t.c.keys())
    print("has batchno", "batchno" in cols, "has batch_no", "batch_no" in cols)
    print("picked", _pick_batch_column(cols))


if __name__ == "__main__":
    main()
