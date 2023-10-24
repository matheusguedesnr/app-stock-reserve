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
          let docId, isCart

          if (trigger.action !== 'delete') {
            docId = trigger.resource_id || trigger.inserted_id
            isCart = resource === 'carts'
          }
          console.log(`> Webhook #${storeId} ${docId} [${trigger.resource}]`)
          // nothing to do
          if (docId && isCart) {
            const docEndpoint = `carts/${docId}.json`
            return appSdk.apiRequest(storeId, docEndpoint).then(async ({ response }) => {
              const doc = response.data
              let customer
              if (doc.completed || doc.available === false) {
                return res.sendStatus(204)
              }
              
              return Promise.all().then(() => {
                if (!res.headersSent) {
                  return res.sendStatus(200)
                }
              })
            }).catch(error => {
              console.error(error)
              const status = error.response
                ? error.response.status || 500 : 409
              return res.sendStatus(status)
            })
          }
          res.sendStatus(204)
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
