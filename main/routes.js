// Dependencies
const request     = require('request');
const path        = require('path');
const express     = require('express');
const Waitlist    = require('../models/waitlist.js');
const EmailClient = require('./email.js');
const config      = require('../config/config.js');
const React     = require('react');
const ReactDOMServer = require('react-dom/server');
const JSX       = require('node-jsx').install();
const EventsApp = React.createFactory(require('./components/EventsApp.react'));
const AnouncementsApp = React.createFactory(require('./components/AnouncementsApp.react'));
const User      = require('../models/user.js');
const GCEvent   = require('../models/GCEvent.js');
const SlackMsg  = require('../models/SlackMsg.js');
const calendar  = require('./calendar.js');

// Middleware
// Authentication Check
const isLoggedIn = function checkLoggedIn(req, res, next) {
  // If load testing
  if(req && req.session && req.session.user_tmp && config.devmode) {
    req.user == req.session.user_tmp;
    return next();
  }
  // Checks if the user is already logged in by checking cookies
  if (req.isAuthenticated()) {
    return next();
  }
  req.flash('info', 'Something happened with authentication! Please log in again.');
  res.redirect('/');
}

//Get Event data
const getEvents = function getEventsData(req, res, next){

  GCEvent.getEvents(0,0, function(events){


    req.body.eventsmarkup = ReactDOMServer.renderToString(
      EventsApp({
        events:events
      })
    );

    req.body.events = events;
    return next();
  });
}

const getTweets = function getTweetsData(req,res,next){
  Tweet.getTweets(0,0, function(tweets){

    req.body.tweetsmarkup = ReactDOMServer.renderToString(
      TweetsApp({
        tweets: tweets
      })
    );

    req.body.tweets = tweets;
    return next();
  });
}

const getAnouncements = function getAnouncementsData(req,res,next){
  SlackMsg.getSlackMsgs(0,0,function(anouncements){

    req.body.anouncementsmarkup = ReactDOMServer.renderToString(
      AnouncementsApp({
        anouncements:anouncements
      })
    );

    req.body.anouncements = anouncements;
    return next();
  });
}

const getQRImage = function getQRImageData(req,res,next){
  var url = 'http://ec2-54-186-192-209.us-west-2.compute.amazonaws.com:8080/images/'+req.user.mlh_data.email+'.png';

  var r = request.defaults({encoding:null});
  r.get(url,(err,response,body)=>{
    if(err){
      console.log(err);
    }else if(response.statusCode === 404 && (req.body.qrRetries == null || req.body.qrRetries < 3)){
      console.log('404 ERROR');
      //NOT SURE IF THIS IS COOL-> generate a new QRImage by passing in email to QRU server
      var qrurl = 'http://ec2-54-186-192-209.us-west-2.compute.amazonaws.com:8080/viewqr?email='+req.user.mlh_data.email;
      request.get(qrurl,(error,resp,bod)=>{
          if(req.body.qrRetries == null){
            req.body.qrRetries = 1;
          }else{
            req.body.qrRetries += 1;
          }
          getQRImageData(req,res,next);
      });
    } else{
      req.body.qrimage = new Buffer(body).toString('base64');
      return next();
    }
  });
}

const aggregateUserData = function aggregateUserData(queries, then) {
  const inner = function (idx, data){
    if (idx == queries.length){
      return then(data);
    }else {
      User.aggregate([{$match: {'registration_status': {$in: [1, 2, 3, 4, 5]}}},
                      { $group: queries[idx]}],
            (err, newData) => inner(idx + 1, data.concat([newData])));
    }
  }

  return inner(0, []);
}

const suggestNextUser = function nextUser(next){
  aggregateUserData(
      config.user_filtering.aggregates.map(
        (agg) => ({_id: '$' + agg, count: {$sum: 1}})
      ), (counts) => {
    User.findOne({'registration_status' : 7}, (err, user) => {
      if(err || user == null){
        next({done: true, counts: counts});
      }else{
        user.registration_status = 8;
        setTimeout(() => {
          console.log("In time out");
          User.findOne({'_id': user._id}, (err, user) => {
            if (!err && user.registration_status == 8){
              user.registration_status = 7;
              console.log("Found and altered user.");
              user.save((err) => console.log(err));
            } else if (err) {
              console.log(err);
            }
          });
        }, 1000 * 60 * 5); //assume invalidation after 5 minutes
        user.save((err) => {
          if (err) console.log(err);
          next({user: user, counts: counts});
        });
      }
    });
  });
}

// Initialization function
const init = function RouteHandler(app, config, passport, upload) {

  app.set('views', path.join(__dirname, config.views));
  app.use(express.static(path.join(__dirname, config.views)));

  app.get('/waiver', (req, res) => res.sendFile(path.join(__dirname, config.views, '/assets/hackru_f17_waiver.pdf')));

  app.get('/', (req, res)=>{
    //console.log(req.session);
    res.render('index.ejs', { user: req.user, message: req.flash('info') });
  });

  app.get('/authenticate', passport.authenticate('mymlh', {
    successRedirect: '/dashboard',
    failureRedirect: '/'
  }));

  app.get('/logout', (req, res)=>{
    req.logout();
    res.redirect('/');
  });

  app.get('/callback/mymlh',
    passport.authenticate('mymlh', {
      successRedirect: '/dashboard',
      failureRedirect: '/'
    })
  );

  app.get('/register-mymlh', isLoggedIn, (req, res)=>{
    //console.log(User.findOne());
    if(req.user.registration_status > 1) {
      return res.redirect('/dashboard');
    }

    res.render('registration.ejs', { show_mlh_cc: true, question: config.user_filtering.short_answer_q, user: req.user, message: req.flash('register') });
  });

  app.get('/register-confirmation', isLoggedIn, (req, res)=>{
    if( req.user.registration_status == 1 || req.user.registration_status == 2 || req.user.registration_status == 3)
        res.render('manage-confirmation.ejs', { user: req.user, message: req.flash('attendance')});
    else
        res.redirect('/dashboard');
  });

  app.get('/gavelQuery',(req,res)=>{
    var url = "https://gavel-ru.herokuapp.com/api/hackerquery/?name="+ encodeURI(req.query.name);
    request.get(url,(err,resp,body)=>{
      if(err) return;
      res.send(body);
    });
  });

  app.get('/dashboard',isLoggedIn,getEvents, getAnouncements, getQRImage,(req,res) =>{
    if(req.user.registration_status==0){
      res.redirect('/register-mymlh');
    } else if (req.user.registration_status == 5) {
      res.render('dashboard-dayof.ejs',{
        user: req.user,
        qrimage:req.body.qrimage,
        anouncementsMarkup: req.body.anouncementsmarkup,

        eventsMarkup: req.body.eventsmarkup
      });
    } else if(req.user.role.admin) {
      res.redirect('/admin');
    } else {
      res.render('dashboard.ejs', { user: req.user, qrimage:req.body.qrimage, message: req.flash('dashboard') });
    }
  });

  app.get('/google4c0be74dc18e6027.html',(req,res)=>{
    res.render('google4c0be74dc18e6027.html');
  });

  app.post('/callback/calendar',(req,res)=>{
    if(req.headers['x-goog-resource-state'] == 'sync'){
      res.sendStatus(201);
    }else{
        console.log(req);
        res.sendStatus(200);
        calendar.loadEvents();
    }
  });

  app.post('/slack',(req,res)=>{
    console.log(req);
    if(req.body.type === 'url_verification'){
      console.log(req.body);
      res.send(''+req.body.challenge);
    }else if(req.body.type === 'event_callback'){
      console.log(req.body.event);
      var slackEvent = req.body.event;
      if(slackEvent.type === 'message'){
        console.log(slackEvent.text);
        if(slackEvent.channel === config.slack.channel){
          var message ={
            ts:slackEvent.ts,
            text:slackEvent.text,
            user:slackEvent.user
          };
          if(slackEvent.subtype == null || slackEvent.subtype != 'channel_join'){
            SlackMsg.findOneAndUpdate({ts:message.ts},message,{upsert:true,new:true},(err,res)=>{
              if(err) console.log(err);
            });
          }
        }
      }
      res.send(200);
    }
  });


  app.get('/registration', isLoggedIn, (req, res)=>{
    res.render('registration.ejs', { show_mlh_cc: false, question: config.user_filtering.short_answer_q, user: req.user, message: req.flash('account') });
  });

  app.get('/resume/:file', isLoggedIn, (req, res)=>{
    // change later
    res.download('resumes/Spring2017/' + req.params.file);
  });

  app.get('/sponsorship', (req, res)=>{
    res.render('sponsorship.ejs');
  });

  app.post('/sponsorship', (req, res)=>{
    var email = new EmailClient();
    email.sendSponsorshipEmail(req.body.sp_email, req.body.sp_message);
    res.render('sponsorship.ejs');
    // res.redirect('/sponsorship');
  });

  app.get('/confirm-status', isLoggedIn, (req, res)=>{
    res.render('manage-confirmation.ejs', { user: req.user, message: req.flash('attendance') });
  });

  app.post('/register-mymlh', isLoggedIn, (req, res)=>{
    // Age Check. Ensures user is older than 18
    let dob = new Date(req.user.mlh_data.date_of_birth);
    let eventdate = new Date(config.event_date);
    let deltaTime = Math.abs(dob.getTime() - eventdate.getTime());
    let deltaDays = Math.ceil(deltaTime/(1000 * 3600 * 24));
    if(req.user.mlh_data.school.id != 2 && req.user.mlh_data.school.id != 2037) {
      if(deltaDays < (18 * 365)) {
        req.flash('info', 'Sorry, you have to be at least 18 to attend this event.');
        return res.redirect('/');
      }
    }
    // Handles resume uploading from multer
    upload.single('resume')(req, res, (err)=>{
      if(err) {
        if(err.code == 'LIMIT_FILE_SIZE') {
          req.flash('register', 'The file you\'re trying to upload is too large! Max Size is 2MB! :(');
          //res.redirect('/register-mymlh');
        } else if(err.code == 'WRONG_FILE_TYPE') {
          req.flash('register', 'Wrong file type. Please upload only PDF, DOC, DOCX, RTF, RTF, TXT files.');
        } else {
          req.flash('register', err.code);
        }
        res.render('registration.ejs', { question: config.user_filtering.short_answer_q, show_mlh_cc: false, user: req.user, message: req.flash('register') });
        return;
      }
      let github = false;
      let resume = false;
      let short_answer = false;
      // Checks if these values changed, if not don't save this part in database.
      if ((req.user.github !== req.body.github) && (req.body.github !== "")) {
        github = true;
      }
      if((req.file) && (req.user.resume !== req.file.originalname)) {
        resume = true;
      }

      short_answer = req.body.short_answer && req.body.short_answer !== req.user.short_answer;
      let grad_year = req.body.grad_year !== req.user.grad_year;
      // Save user in database
      User.findOne({ '_id': req.user._id }, (err, user)=>{
        if (err) {
          throw err;
        }
        if(github) {
          user.github = req.body.github;
        }
        if(resume) {
          user.resume = req.file.originalname;
        }

        if(short_answer) {
          user.short_answer = req.body.short_answer;
        }
        if(grad_year) {
          user.grad_year = req.body.grad_year;
        }
        user.data_sharing = true;
        user.rules_and_conditions = true;
        user.registration_status = 7;
        // Save user to database and send email.
        user.save((err)=>{
          if (err) {
            console.log(err);
            throw err;
          }
          res.redirect('/register-confirmation');
        });
      });
    });
  });

  app.post('/account', isLoggedIn, (req, res)=>{
    // Handles Resume Uploading
    upload.single('resume')(req, res, (err)=>{
      if(err) {
        if(err.code == 'LIMIT_FILE_SIZE') {
          req.flash('account', 'The file you\'re trying to upload is too large! Max Size is 2MB! :(');
        } else if(err.code == 'WRONG_FILE_TYPE') {
          req.flash('account', 'Wrong file type. Please upload only PDF, DOC, DOCX, RTF, RTF, TXT files.');
        } else {
          req.flash('account', err.code);
        }
        res.render('registration.ejs', { question: config.user_filtering.short_answer_q, user: req.user, message: req.flash('account') });
        return;
      }
      let github = false;
      let resume = false;
      let short_answer = false;
      // Checks if these values changed, if not don't save this part in database.
      if ((req.user.github !== req.body.github) && (req.body.github !== "")) {
        github = true;
      }
      if((req.file) && (req.user.resume !== req.file.originalname)) {
        resume = true;
      }

      short_answer = req.body.short_answer && req.body.short_answer !== req.user.short_answer;
      let grad_year = req.body.grad_year !== req.user.grad_year;
      // Save changes in database
      User.findOne({ '_id': req.user._id }, (err, user)=>{
        if (err) {
          throw err;
        }
        if(github) {
          user.github = req.body.github;
        }
        if(resume) {
          user.resume = req.file.originalname;
        }
        if(short_answer) {
          user.short_answer = req.body.short_answer;
        }
        if(grad_year) {
          user.grad_year = req.body.grad_year;
        }
        user.data_sharing = true;
        user.save((err)=>{
          if (err) {
            console.log(err);
            throw err;
          }
          req.flash('account', 'Success! Your information was saved.')
          res.redirect('/registration');
        });
      });
    });
  });

  app.post('/confirm-status', isLoggedIn, (req, res)=>{

    var email = new EmailClient();
    // Finds the current user
    User.findOne({ '_id': req.user._id }, (err, user)=>{
      if (err) {
        throw err;
      }

      // Determine attendance from POST request
      // if Attending, see if there's space, else set Not Attending
      if (req.body.attendance === 'attending') {
        // if not already registered
        if (user.registration_status != 3) {
          User.count({'registration_status': 3}, (err, count)=>{
            // If current amount of users who are confirmed is less than set capacity
            if (count < config.capacity) {
              // Set confirmed
              user.registration_status = 3;
              // Save status and send confirmation email
              user.save((err)=>{
                if (err) {
                  throw err;
                }
                email.sendConfirmedEmail(user.local.email);
                req.flash('dashboard', 'Thanks for confirming! We\'ve sent an email with some information');
                return res.redirect('/dashboard');
              });
            } else {
              // Capacity has been filled, check space in waitlist
              Waitlist.count({}, (err, queueSize)=>{
                // If the current size of the waitlist is less than waitlist capacity
                if (queueSize < config.waitlistCapacity) {
                  // If there's space in waitlist, set waitlist status
                  user.registration_status = 4;
                  // Create alog of this user being wailisted in the Waitlist Collection in database
                  var waitlisted = new Waitlist();

                  waitlisted.id = user.id;
                  waitlisted.mlhid = user.mlh_data.mlhid;
                  // Save user in Waitlist Collection
                  waitlisted.save((err)=>{
                    if (err) {
                      throw err;
                    }
                    req.flash('dashboard', 'You\'re on the waitlist! We\'ve sent an email with some information');
                    email.sendWaitlistEmail(user.local.email);
                    user.save((err)=>{
                      if (err) {
                        throw err;
                      }
                      return res.redirect('/dashboard');
                    });
                  });

                } else {
                  // If there's no space in Confirmed Attandance and Waitlist is full the user can't attend at all.
                  req.flash('dashboard', 'Sorry, our waitlist is full. Currently, you may not attend HackRU, but check back later; spots on the waitlist may open up.');
                  res.redirect('/dashboard');
                }
              });
            }
          });
        } else {
          return res.redirect('/dashboard');
        }
      } else {
        // Set Not Attending
        user.registration_status = 2;
        // Save in User Collection
        user.save((err)=>{
          if (err) {
            throw err;
          }
          return res.redirect('/dashboard');
        });
        // After setting someone to "Not Attending" status, determine whether or not there's space for someone on waitlist.
        Users.count({'registration_status': 3}, (err, count)=>{
          // If amount of confirmed users is less than the capacity, move oldest user from waitlist into confirmed.
          // if there isn't enough space then do nothing.
          if (count < config.capacity) {
            // If there is space, check if the waitlist has anyone waiting.
            Waitlist.count({}, (err, waitlistCount)=>{
              if (waitlistCount > 0) {
                // Loop Waitlist Collection in DB to find oldest document
                Waitlist.find({}).sort({'datetime': 1}).limit(1).exec((err, waitlistUser)=>{
                  if (err) {
                    console.log('Could not find user in waitlist');
                  }
                  // user's ID is in waitlistUser[0].id
                  // user is an array of objects
                  // Take Oldest document's id and find it in User's Collection
                  User.find({'id': waitlistUser[0].id}, (err, newConfirmedUser)=>{
                    // Set that user to Confirmed
                    newConfirmedUser.registration_status = 3;
                    newConfirmedUser.save((err)=>{
                      if (err) {
                        throw err;
                      }
                      email.sendConfirmedEmail(newConfirmedUser.local.email);
                    });
                  });
                  // Remove Oldest Document from Waitlist Collection
                  Waitlist.find({'id': waitlistUser[0].id}).remove().exec();
                });
              }
            });
          }
        });
      }
    });
  });

  app.get('/admin-swiped', (req, res) => {
    User.findOneAndUpdate({'_id': req.query.user_id}, { 'registration_status': (req.query.accepted == '1')? 1: 6}, {}, (err, result) => {
      if(err) {
        console.log(err);
      }

      let is_post_batch = (new Date()).getTime() > (new Date(config.batch_email_date)).getTime();
      if(req.query.accepted == '1' && is_post_batch){
        let email = new EmailClient();
        email.sendConfirmAttendanceEmail(user.local.email);
      }
      //can't be point-free because JS is not Haskell
      suggestNextUser((data) => res.json(data));
    })
  });

  app.get('/admin', (req, res)=>{
    if(!req.user || !req.user.role.admin){
      res.redirect('/dashboard');
      return;
    }

    let eventdate = new Date(config.event_date);
    let nowDate = new Date();
    let now = nowDate.getTime() === eventdate.getTime()
    if(now){
      User.count({ 'registration_status': 5 }, (err, count)=>{
        res.render('admin.ejs', { counts: false, now: now, checkin: count, message: req.flash('admin') });
      });
    }else{
      suggestNextUser((user) => {
        if(user.done){
          res.render('admin.ejs', { now: now, counts: JSON.stringify(user.counts, null, '\t'), done: true, message: req.flash('admin') });
        }else{
          redacted_user = {
            short_answer: user.user.short_answer,
            grad_year: user.user.grad_year,
            mlh_data: {gender: user.user.mlh_data.gender},
            id: user.user._id
          };
          res.render('admin.ejs', {
            question: config.user_filtering.short_answer_q,
            now: now, done: false, user: redacted_user,
            counts: JSON.stringify(user.counts, null, '\t'), message: req.flash('admin')
          });
        }
      });
    }
  });

  app.get('/auth/fake/test', (req, res)=>{
    if(config.devmode) {
      req.session = req.session || {};
      req.session.passport = config.fakeuser.passport;
      isLoggedIn(req, res, res.redirect('/'));
    }
    return res.redirect('/');
  });

};

module.exports = init;
