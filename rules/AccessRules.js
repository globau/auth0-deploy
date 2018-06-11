function (user, context, callback) {
  var rules_url = 'https://cdn.sso.mozilla.com/apps.yml'; //S3 bucket with CFN
  var groups = user.groups || [];

  // Check if array A has any occurence from array B
  function array_in_array(A, B) {
    var found = A.some(
      function(item) {
        if (!B)
          return false;
        return B.indexOf(item) >= 0;
    });
    return found;
  }
  function access_granted(a, b, c) {
    updateAccessExpiration();
    return callback(a, b, c);
  }

  function access_denied(a, b, c) {
    return callback(a, b, c);
  }

  // updateAccessExpiration()
  // Always returns - will attempt to update user.app_metadata.authoritativeGroups[].lastUsed timestamp
  // for the RP/client_id we're currently trying to login to
  function updateAccessExpiration() {
      user.app_metadata = user.app_metadata || {};
      if (user.app_metadata.authoritativeGroups === undefined) {
          console.log('ExpirationOfAccess: Not used here');
          return;
      }

      var updated = false;
      for (var index = 0;index < user.app_metadata.authoritativeGroups.length;++index) {
        if (user.app_metadata.authoritativeGroups[index].uuid === context.clientID) {
          user.app_metadata.authoritativeGroups[index].lastUsed = new Date();
          updated = true;
          break; // we're done
        }
      }
      if (updated === true) {
        auth0.users.updateAppMetadata(user.user_id, user.app_metadata)
          .catch(function(err) {
          console.log('ExpirationOfAccess: Error updating app_metadata (AuthoritativeGroups) for user '+user.user_id+': '+err);
        });
      }
      console.log('ExpirationOfAccess: Updated lastUsed for '+user.user_id);
      return;
  }

  // Process the access cache decision
  function access_decision(access_rules) {
    for (var i=0;i<access_rules.length;i++) {
      var app = access_rules[i].application;

      //Handy for quick testing in dev (overrides access rules)
      //var app = {'client_id': 'pCGEHXW0VQNrQKURDcGi0tghh7NwWGhW', // This is testrp social-ldap-pwless
      //           'authorized_users': ['gdestuynder@mozilla.com'],
      //           'authorized_groups': ['okta_mfa'],
      //           'expire_access_when_unused_after': 86400
      //          };

      if (app.client_id && (app.client_id.indexOf(context.clientID) >= 0)) {
        // Note that the expiration check MUST always run first
        // Check if the user access to the RP has expired due to ExpirationOfAccess
        if ((app.expire_access_when_unused_after !== undefined) && (app.expire_access_when_unused_after > 0)) {
          user.app_metadata = user.app_metadata || {};
          // If the user has no authoritativeGroups for this clientID, let the user in
          if (user.app_metadata.authoritativeGroups !== undefined) {
            for (var index=0;index < user.app_metadata.authoritativeGroups.length; ++index) {
              if (user.app_metadata.authoritativeGroups[index].uuid === context.clientID) {
                // Find the delta for this user and see if access should have expired
                var lastUsed_ts = new Date(user.app_metadata.authoritativeGroups[index].lastUsed).getTime();
                var delta = new Date().getTime() - lastUsed_ts;
                // Access expired?
                if (delta > app.expire_access_when_unused_after) {
                    // Do not allow the user in, no matter what other access has been set
                    console.log("Access denied to "+context.clientID+" for user "+user.email+" ("+user.user_id+") - access has expired");
                    return access_denied(null, user, global.postError('accesshasexpired', context));
                }
                break;
              }
            }
          }
        }

        // XXX this authorized_users SHOULD BE REMOVED as it's unsafe. USE GROUPS.
        // XXX This needs to be fixed in the dashboard first
        // Empty users or groups (length == 0) means no access in the dashboard apps.yml world
        if (app.authorized_users.length === app.authorized_groups.length === 0) {
          console.log("Access denied to "+context.clientID+" for user "+user.email+" ("+user.user_id+") - this app denies ALL users and ALL groups");
          return access_denied(null, user, global.postError('notingroup', context));
        }

        // Check if the user is authorized to access
        if ((app.authorized_users.length > 0 ) && (app.authorized_users.indexOf(user.email) >= 0)) {
          return access_granted(null, user, context);
        // Same dance as above, but for groups
        } else if ((app.authorized_groups.length > 0) && array_in_array(app.authorized_groups, groups)) {
          return access_granted(null, user, context);
        }

        console.log("Access denied to "+context.clientID+" for user "+user.email+" ("+user.user_id+") - not in authorized group or not an authorized user");
        return access_denied(null, user, global.postError('notingroup', context));
      } // correct client id
    } // for loop
    // We matched no rule, access is granted
    return access_granted(null, user, context);
  }

  // Fetch the apps.yml access rules or use cache if available
  // Note that the cache is very short lived, though it's better than nothing
  // Basically: the underlaying webtask is still running and reused,
  // thus the global namespace (`global`) is shared/still in memory and available to us
  if (global.access_rules) {
    return access_decision(global.access_rules);
  } else {
    var request = require('request');
    var YAML = require('js-yaml');
    try {
      var options = { method: 'GET',
        url: rules_url};
      request(options, function (error, response, body) {
        if (error) throw new Error(error);
        global.access_rules = YAML.load(body).apps;
        return access_decision(global.access_rules);
      });
    } catch(e) {
      console.log('Error fetching access rules (fatal): '+e);
      return access_denied(null, null, context);
    }
  }
}
