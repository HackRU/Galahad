import requests as req
from pymongo import MongoClient, UpdateOne, BulkWriteError.

import config
from schemas import *

def req_matrix_and_clean(params):
    def elem_to_dist(elem):
        if elem['status'] != 'OK':
            return 0
        else:
            return elem['distance']['value']

    MATRIX_BASE_URL = "https://maps.googleapis.com/maps/api/distancematrix/json"
    got = req.get(MATRIX_BASE_URL, params=params)
    got.raise_for_status()
    mat = got.json()
    if mat['status'] != 'OK':
        raise ValueError(mat)

    return {val: elem_to_dist(mat['rows'][idx]['elements'][0]) for idx, val in enumerate(mat['origin_addresses'])}

def req_distance_matrices(users):
    origins = "|".join(u['travelling_from']['formatted_addr'] for u in users)
    destinations = config.TRAVEL.HACKRU_LOCATION

    car_params = {
        "origins": origins,
        "destinations": destinations,
        "mode": "driving",
        "key": config.MAPS_API_KEY,
    }
    train_params = {
        "origins": origins,
        "destinations": destinations,
        "mode": "transit",
        "transit_mode": "train",
        "key": config.MAPS_API_KEY,
    }
    bus_params = {
        "origins": origins,
        "destinations": destinations,
        "mode": "transit",
        "transit_mode": "bus",
        "key": config.MAPS_API_KEY,
    }

    return {
        "car": req_matrix_and_clean(car_params),
        "bus": req_matrix_and_clean(bus_params),
        "train": req_matrix_and_clean(train_params)
    }

def users_to_reimburse(lookup, users):
    total = 0
    table = dict()
    for user in users:
        if user['travelling_from']['mode'] != 'plane':
            dist = lookup[user['travelling_from']['mode']].get(user['travelling_from']['formatted_addr'], 0)
            reimburse = min(dist * config.TRAVEL.MULTIPLIERS[user['travelling_from']['mode']], config.TRAVEL.MAX_REIMBURSE)
        else:
            reimburse = config.TRAVEL.MAX_REIMBURSE
        total += reimburse
        table[user['email']] = reimburse

    if total > config.TRAVEL.BUDGET:
        table = {i: table[i] * config.TRAVEL.BUDGET / total for i in table}

    return table, min(total, config.TRAVEL.BUDGET)

@ensure_schema({
    "type": "object",
    "properties": {
        "email": {"type": "string", "format": "email"},
        "token": {"type": "string"},
    },
    "required": ["email", "token"]
})
@ensure_logged_in_user()
@ensure_role([['director']])
def compute_all_reimburse(event, context, user):
    client = MongoClient(config.DB_URI)
    db = client[config.DB_NAME]
    db.authenticate(config.DB_USER,config.DB_PASS)
    tests = db[config.DB_COLLECTIONS['users']]

    users = list(tests.find({"travelling_from": {"$exists": True}, "travelling_from.addr_ready": True}))
    try:
        lookup = req_distance_matrices(users)
    except Exception as e:
        return {'statusCode': 512, 'body': repr(e)}

    table, total = users_to_reimburse(lookup, users)
    bulk_op = [UpdateOne({'email':i}, {'$set': {'travelling_from.reimbursement': table[i]}}) for i in table]
    try:
        data = tests.bulk_write(bulk_op, ordered=False)
        return {'statusCode': 200, 'mongo_result': data.bulk_api_result, 'total': total}
    except BulkWriteError as bwe:
        return {'statusCode': 512, 'body': bwe.details}

