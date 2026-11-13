from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow():
    return datetime.now(UTC).replace(microsecond=0, tzinfo=None)


class Network(Base):
    __tablename__ = "networks"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)


class Village(Base):
    __tablename__ = "villages"
    id: Mapped[int] = mapped_column(primary_key=True)
    network_id: Mapped[int | None] = mapped_column(ForeignKey("networks.id"))
    name: Mapped[str] = mapped_column(String(120))
    tz: Mapped[str] = mapped_column(String(40), default="Asia/Bangkok")
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    zones: Mapped[list["Zone"]] = relationship(back_populates="village")
    meters: Mapped[list["Meter"]] = relationship(back_populates="village")


class Zone(Base):
    __tablename__ = "zones"
    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"))
    name: Mapped[str] = mapped_column(String(80))
    village: Mapped[Village] = relationship(back_populates="zones")


class Meter(Base):
    __tablename__ = "meters"
    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"))
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"))
    kind: Mapped[str] = mapped_column(String(10))
    label: Mapped[str] = mapped_column(String(80))
    n_digits: Mapped[int] = mapped_column(Integer, default=5)
    scale: Mapped[float] = mapped_column(Float, default=1.0)
    max_flow: Mapped[float] = mapped_column(Float, default=3.125)
    resolution: Mapped[float | None] = mapped_column(Float)
    roi: Mapped[list | None] = mapped_column(JSON)
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    village: Mapped[Village] = relationship(back_populates="meters")


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    meter_id: Mapped[int] = mapped_column(ForeignKey("meters.id"))
    token_hash: Mapped[str] = mapped_column(String(64))
    last_seen: Mapped[datetime | None] = mapped_column(DateTime)
    last_status: Mapped[dict | None] = mapped_column(JSON)
    commands: Mapped[dict] = mapped_column(JSON, default=dict)
    meter: Mapped[Meter] = relationship()


class Heartbeat(Base):
    __tablename__ = "heartbeats"
    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), index=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    data: Mapped[dict] = mapped_column(JSON)


class Photo(Base):
    __tablename__ = "photos"
    __table_args__ = (UniqueConstraint("device_id", "seq", "light"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    meter_id: Mapped[int] = mapped_column(ForeignKey("meters.id"), index=True)
    device_id: Mapped[str | None] = mapped_column(ForeignKey("devices.id"))
    seq: Mapped[int | None] = mapped_column(Integer)
    light: Mapped[str | None] = mapped_column(String(2))
    taken_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    time_estimated: Mapped[bool] = mapped_column(Boolean, default=False)
    jpeg: Mapped[bytes] = mapped_column(LargeBinary)
    ocr: Mapped[dict | None] = mapped_column(JSON)


class Reading(Base):
    __tablename__ = "readings"
    __table_args__ = (UniqueConstraint("device_id", "seq"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    meter_id: Mapped[int] = mapped_column(ForeignKey("meters.id"), index=True)
    device_id: Mapped[str | None] = mapped_column(ForeignKey("devices.id"))
    seq: Mapped[int | None] = mapped_column(Integer)
    taken_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    value: Mapped[float | None] = mapped_column(Float)
    suggested: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(10), index=True)
    photo_id: Mapped[int | None] = mapped_column(ForeignKey("photos.id"))
    issues: Mapped[list] = mapped_column(JSON, default=list)
    confirmed_by: Mapped[str | None] = mapped_column(String(80))


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    key: Mapped[str] = mapped_column(String(60))
    level: Mapped[str] = mapped_column(String(10))
    started: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    resolved: Mapped[datetime | None] = mapped_column(DateTime)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class NightTest(Base):
    __tablename__ = "night_tests"
    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"))
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"))
    night_of: Mapped[str] = mapped_column(String(10))
    created: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Person(Base):
    __tablename__ = "people"
    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int | None] = mapped_column(ForeignKey("villages.id"), index=True)
    network_id: Mapped[int | None] = mapped_column(ForeignKey("networks.id"))
    name: Mapped[str] = mapped_column(String(80))
    phone: Mapped[str | None] = mapped_column(String(20), unique=True)
    pin_hash: Mapped[str | None] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(12), default="resident")
    meter_id: Mapped[int | None] = mapped_column(ForeignKey("meters.id"))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    demo: Mapped[bool] = mapped_column(Boolean, default=False)


class Bill(Base):
    __tablename__ = "bills"
    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"), index=True)
    meter_id: Mapped[int] = mapped_column(ForeignKey("meters.id"), index=True)
    reading_id: Mapped[int] = mapped_column(ForeignKey("readings.id"))
    prev_value: Mapped[float] = mapped_column(Float)
    value: Mapped[float] = mapped_column(Float)
    m3: Mapped[float] = mapped_column(Float)
    amount: Mapped[float] = mapped_column(Float)
    issued: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    due: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(10), default="unpaid")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime)
    paid_via: Mapped[str | None] = mapped_column(String(10))


class FundEntry(Base):
    __tablename__ = "fund_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int | None] = mapped_column(ForeignKey("villages.id"), index=True)
    network_id: Mapped[int | None] = mapped_column(ForeignKey("networks.id"), index=True)
    wallet: Mapped[str] = mapped_column(String(10))
    amount: Mapped[float] = mapped_column(Float)
    kind: Mapped[str] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(String(200))
    ref: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(10), default="approved")
    created: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("people.id"))
    approvals: Mapped[list] = mapped_column(JSON, default=list)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class RepairJob(Base):
    __tablename__ = "repair_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"), index=True)
    zone_id: Mapped[int | None] = mapped_column(ForeignKey("zones.id"))
    kind: Mapped[str] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(String(10), default="resident")
    note: Mapped[str | None] = mapped_column(String(500))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    photo: Mapped[bytes | None] = mapped_column(LargeBinary)
    reported_by: Mapped[int | None] = mapped_column(ForeignKey("people.id"))
    alert_id: Mapped[int | None] = mapped_column(ForeignKey("alerts.id"))
    litres_per_day: Mapped[float | None] = mapped_column(Float)
    size: Mapped[str | None] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(12), default="open")
    technician_id: Mapped[int | None] = mapped_column(ForeignKey("people.id"))
    depot_id: Mapped[int | None] = mapped_column(ForeignKey("depots.id"))
    parts: Mapped[list] = mapped_column(JSON, default=list)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    history: Mapped[list] = mapped_column(JSON, default=list)
    proof: Mapped[dict | None] = mapped_column(JSON, default=dict)
    eta: Mapped[datetime | None] = mapped_column(DateTime)


class Depot(Base):
    __tablename__ = "depots"
    id: Mapped[int] = mapped_column(primary_key=True)
    network_id: Mapped[int] = mapped_column(ForeignKey("networks.id"))
    name: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float | None] = mapped_column(Float)
    lon: Mapped[float | None] = mapped_column(Float)
    items: Mapped[dict] = mapped_column(JSON, default=dict)
    log: Mapped[list] = mapped_column(JSON, default=list)


class PointEntry(Base):
    __tablename__ = "points"
    id: Mapped[int] = mapped_column(primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), index=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"), index=True)
    points: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(20))
    ref: Mapped[str | None] = mapped_column(String(40))
    created: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ThankYou(Base):
    __tablename__ = "thanks"
    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"), index=True)
    text: Mapped[str] = mapped_column(String(280))
    created: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class StepTest(Base):
    __tablename__ = "step_tests"
    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"), index=True)
    meter_id: Mapped[int] = mapped_column(ForeignKey("meters.id"))
    created: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("people.id"))
    steps: Mapped[list] = mapped_column(JSON, default=list)
    finished: Mapped[datetime | None] = mapped_column(DateTime)
    note: Mapped[str | None] = mapped_column(String(300))


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    village_id: Mapped[int] = mapped_column(ForeignKey("villages.id"), index=True)
    person_id: Mapped[int | None] = mapped_column(ForeignKey("people.id"))
    job_id: Mapped[int | None] = mapped_column(ForeignKey("repair_jobs.id"))
    name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(12))
    text: Mapped[str] = mapped_column(String(500))
    created: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
