// read configured E-Com Plus app data
const getAppData = require('./../../lib/store-api/get-app-data')

const SKIP_TRIGGER_NAME = 'SkipTrigger'
const ECHO_SUCCESS = 'SUCCESS'
const ECHO_SKIP = 'SKIP'
const ECHO_API_ERROR = 'STORE_API_ERR'

exports.post = async ({ appSdk, admin }, req, res) => {
  // receiving notification from Store API
  const { storeId } = req

  /**
   * Treat E-Com Plus trigger body here
   * Ref.: https://developers.e-com.plus/docs/api/#/store/triggers/
   */
  const trigger = req.body
  const resourceId = trigger.resource_id || trigger.inserted_id
  appSdk.getAuth(storeId)
    .then((auth) => {
      return getAppData({ appSdk, storeId, auth })
        .then(appData => {
          if (
            Array.isArray(appData.ignore_triggers) &&
            appData.ignore_triggers.indexOf(trigger.resource) > -1
          ) {
            // ignore current trigger
            const err = new Error()
            err.name = SKIP_TRIGGER_NAME
            throw err
          }

          /* DO YOUR CUSTOM STUFF HERE */
          console.log(`> Webhook #${storeId} ${resourceId} [${trigger.resource}]`)

          /* if (trigger.resource === 'applications') {
            integrationConfig = appData
            canCreateNew = true
          } else if (trigger.authentication_id !== auth.myId) {
            switch (trigger.resource) {
              case 'orders':
                if (trigger.body) {
                  canCreateNew = appData.new_orders ? undefined : false
                  integrationConfig = {
                    _exportation: {
                      order_ids: [resourceId]
                    }
                  }
                }
                break

              case 'products':
                if (trigger.body) {
                  if (trigger.action === 'create') {
                    if (!appData.new_products) {
                      break
                    }
                    canCreateNew = true
                  } else if (
                    (!trigger.body.price || !appData.export_price) &&
                    (!trigger.body.quantity || !appData.export_quantity)
                  ) {
                    break
                  }
                  integrationConfig = {
                    _exportation: {
                      product_ids: [resourceId]
                    }
                  }
                }
                break
            }
          } */
          // nothing to do
          return {}
        })
        .catch(err => {
      if (err.name === SKIP_TRIGGER_NAME) {
        // trigger ignored by app configuration
        res.send(ECHO_SKIP)
      } else if (err.appWithoutAuth === true) {
        const msg = `Webhook for ${storeId} unhandled with no authentication found`
        const error = new Error(msg)
        error.trigger = JSON.stringify(trigger)
        console.error(error)
        res.status(412).send(msg)
      } else {
        // console.error(err)
        // request to Store API with error response
        // return error status code
        res.status(500)
        const { message } = err
        res.send({
          error: ECHO_API_ERROR,
          message
        })
      }
    })
    })

    
}
