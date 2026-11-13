from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from .community import first_name, get_db, iso, need
from .models import Comment, Person, Village

router = APIRouter(prefix="/api")


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    job_id: int | None = None


def allowed(db, p, vid):
    v = db.get(Village, vid)
    if v is None:
        raise HTTPException(404, "village not found")
    if p.role == "admin" or p.village_id == vid or (p.role == "technician" and p.network_id and p.network_id == v.network_id):
        return v
    raise HTTPException(403, "not your village")


def comment_dict(c):
    return {"id": c.id, "name": c.name, "role": c.role, "text": c.text, "job_id": c.job_id, "created": iso(c.created)}


def system_note(db, job, text):
    db.add(Comment(village_id=job.village_id, job_id=job.id, name="NamJai", role="system", text=text))


@router.get("/villages/{vid}/comments")
def comments(vid: int, after: int = 0, p: Person = Depends(need()), db=Depends(get_db)):
    allowed(db, p, vid)
    rows = db.scalars(select(Comment).where(Comment.village_id == vid, Comment.id > after).order_by(Comment.id.desc()).limit(50)).all()
    return [comment_dict(c) for c in reversed(rows)]


@router.post("/villages/{vid}/comments", status_code=201)
def comments_add(vid: int, body: CommentIn, p: Person = Depends(need()), db=Depends(get_db)):
    allowed(db, p, vid)
    if not body.text.strip():
        raise HTTPException(422, "empty message")
    c = Comment(village_id=vid, person_id=p.id, job_id=body.job_id, name=first_name(p), role=p.role, text=body.text.strip())
    db.add(c)
    db.commit()
    return comment_dict(c)
