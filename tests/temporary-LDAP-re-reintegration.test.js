const _ = require('lodash');

const configuration = require('./modules/global/configuration.js');
const context = require('./modules/contexts/context.js');
const Global = require('./modules/global/global.js');
const user = require('./modules/users/user.js');
const auth0 = require('./modules/global/auth0.js');

const loader = require('./modules/rule-loader.js');
const rule = loader.load('temporary-LDAP-re-reintegration.js', false);


// jest setup to reset _user and _context, preventing tests from writing to objects
beforeEach(() => {
  _user = _.cloneDeep(user);
  _context = _.cloneDeep(context);
  output = undefined;
});


test('Test Placeholder', () => {
  output = rule(_user, _context, configuration, Global, auth0);

  expect(true).toEqual(true);
});
