from src import authorize, util
import config
from src.slack import generate_dm_link

# credentials of the generator
email = "generator@test.com"
email_linked = "email@mailmyrss.com"
password = "temp_password"
token = None
slack_id = "U010WR7TMAQ"

# credentials of the other user
other_email = "other@test.com"
other_email_linked = "other_email@mailmyrss.com"
other_password = "secure_password"
other_slack_id = "U010WRFRJ7N"

# collections and database
old_col = None
db = None

payload = None

current_slack_key = ""


# helper method to unset the slack id in the db document identified by slack_email
def unset_slack_id(slack_email):
    update = db.update_one({"email": slack_email}, {"$unset": {"slack_id": 1}})
    assert update.modified_count >= 1


# helper method to set the slack id to the slack_id_to_set in the db document identified by email_to_set
def set_slack_id(email_to_set, slack_id_to_set):
    update = db.update_one({"email": email_to_set}, {"$set": {"slack_id": slack_id_to_set}})
    assert update.modified_count >= 1


# method that sets up the module in preparation for running the tests
def setup_module(m):
    # import globals and switch the collection to a temporary collection
    global old_col, token, db, payload, current_slack_key
    old_col = config.DB_COLLECTIONS["users"]
    config.DB_COLLECTIONS["users"] = "test-users"

    # swap the key to be fetched from environment variable
    current_slack_key = config.SLACK_KEYS["token"]

    # create a dummy user
    result = authorize.create_user({"email": email, "password": password}, {})
    assert result["statusCode"] == 200
    token = result["body"]["token"]
    payload = {
        "token": token,
        "other_email": other_email
    }

    # create another dummy user
    result = authorize.create_user({"email": other_email, "password": other_password}, {})
    assert result["statusCode"] == 200
    assert bool(config.SLACK_KEYS["token"])

    # create a dummy user with linked email to slack
    result = authorize.create_user({"email": email_linked, "password": password}, {})
    assert result["statusCode"] == 200
    assert bool(config.SLACK_KEYS["token"])

    # create a dummy user with linked email to slack
    result = authorize.create_user({"email": other_email_linked, "password": other_password}, {})
    assert result["statusCode"] == 200
    assert bool(config.SLACK_KEYS["token"])

    # sets the slack id in the db documents
    db = util.coll("users")
    set_slack_id(email, slack_id)
    set_slack_id(other_email, other_slack_id)


# tears down a module
def teardown_module(m):
    # drops the temp collection that was created
    global db, old_col, current_slack_key
    db = util.get_db()
    db[config.DB_COLLECTIONS["users"]].drop()
    config.DB_COLLECTIONS["users"] = old_col

    # restore the slack api key
    config.SLACK_KEYS["token"] = current_slack_key


def test_bad_token():
    response = generate_dm_link({"token": "bad token", "other_email": other_email}, {})
    assert response["statusCode"] == 403


def test_bad_other_email():
    response = generate_dm_link({"token": token, "other_email": "invalid@email.com"}, {})
    assert response["statusCode"] == 403


def test_misconfigured_slack_token():
    slack_token = config.SLACK_KEYS["token"]
    config.SLACK_KEYS["token"] = "bad slack token"
    response = generate_dm_link(payload, {})
    assert response["statusCode"] == 503
    config.SLACK_KEYS["token"] = slack_token


def test_missing_slack_id_and_unlinked_email():
    unset_slack_id(email)
    response = generate_dm_link(payload, {})
    assert response["statusCode"] == 403
    assert response["body"] == "Requester's Slack ID not present within LCS and email is not linked to a Slack ID"
    set_slack_id(email, slack_id)

    unset_slack_id(other_email)
    response = generate_dm_link(payload, {})
    assert response["statusCode"] == 403
    assert response["body"] == "Other user's Slack ID not present within LCS and email is not linked to a Slack ID"
    set_slack_id(other_email, other_slack_id)


def test_invalid_slack_id():
    set_slack_id(email, "bad slack id")
    response = generate_dm_link(payload, {})
    assert response["statusCode"] == 403
    assert response["body"] == "contains_invalid_user: The id for one of the provided users were invalid"
    set_slack_id(email, slack_id)

    set_slack_id(other_email, "bad slack id")
    response = generate_dm_link(payload, {})
    assert response["statusCode"] == 403
    assert response["body"] == "contains_invalid_user: The id for one of the provided users were invalid"
    set_slack_id(other_email, other_slack_id)

    set_slack_id(email, "bad slack id")
    set_slack_id(other_email, "bad slack id")
    response = generate_dm_link(payload, {})
    assert response["statusCode"] == 403
    assert response["body"] == "user_not_found: The id for both of the provided users were invalid"
    set_slack_id(email, slack_id)
    set_slack_id(other_email, other_slack_id)


def test_valid_use():
    response = generate_dm_link(payload, {})
    assert response["statusCode"] == 200

def test_missing_ids_with_linked_emails():
    payload["other_email"] = other_email_linked
    response = generate_dm_link(payload, {})
    assert response["statusCode"] == 200

