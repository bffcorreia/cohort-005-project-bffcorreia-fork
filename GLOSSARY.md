# Cadence

Cadence is a platform where learners buy and take online courses.

## Language

### Refunds

**Refund Request**:
A learner's request to get their money back for a course purchase, which the team reviews before anything is decided.
_Avoid_: Cancellation, Reversal, Chargeback

**Refund**:
Money actually returned to a learner after their Refund Request is approved. A pending request is never called a refund.
_Avoid_: Reversal

**Refunded Purchase**:
A purchase whose Refund Request was approved, so the learner has their money back and no longer has access to the course.
_Avoid_: Cancelled purchase, Revoked purchase

**Refund Eligibility**:
Whether a purchase passes every refund rule, so the learner can make a Refund Request for it.
_Avoid_: Cancellation offer, Refund offer

**Refund Window**:
The time from a purchase until the end of the 14th calendar day after the purchase day, during which a Refund Request can be made.
_Avoid_: Cancel window

**Refund Request Status**:
Where a Refund Request is in review. It is Requested (made, nobody has acted on it yet), Approved (accepted, resulting in a Refund and a Refunded Purchase) or Declined (rejected, so the learner keeps the course and we keep the money). A purchase can have only one Requested Refund Request at a time.
_Avoid_: Open, Pending

**Resolved Refund Request**:
A Refund Request whose status is Approved or Declined.
_Avoid_: Closed, Done

**Refundable Amount**:
The money a Refund Request would return to the learner if it were Approved, which is always exactly what they paid for the purchase.
_Avoid_: Refund amount
