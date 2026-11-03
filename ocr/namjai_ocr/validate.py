def check(reading, prev=None, hours=None, max_flow=None, digits=None):
    if prev is None or reading is None:
        return []
    delta = reading - prev
    if delta < 0:
        size = 10 ** digits if digits else None
        if size and prev > 0.9 * size and reading < 0.1 * size:
            delta += size
        else:
            return ["decreased"]
    if max_flow is not None and hours is not None and delta > max_flow * max(hours, 1 / 60):
        return ["jump_too_large"]
    return []
