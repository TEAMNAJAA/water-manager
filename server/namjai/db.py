from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from . import config


class Base(DeclarativeBase):
    pass


def make_engine(url=None):
    url = (url or config.DATABASE_URL).replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=args, pool_pre_ping=True)


engine = make_engine()
Session = sessionmaker(engine, expire_on_commit=False)


def init(eng=None):
    from . import models  # noqa: F401
    Base.metadata.create_all(eng or engine)
